//
//  GlazeAI.swift
//  Glaze Extension
//
//  The `apple` AI provider's native side (lib/ai/providers/apple.js, docs/ai-harness.md): Apple's Foundation Models, on
//  this device or on Private Cloud Compute, answering browser.runtime.sendNativeMessage. One message, one reply; nothing
//  streams. Messages:
//    { type: 'ai.status', model: 'on-device' | 'private-cloud' }
//      → { ok: true, state: 'ready' | 'downloading' | 'unavailable', reason?, unverified?, context?, images?, quota? }
//    { type: 'ai.run', id, model, messages, schema?, temperature?, maxTokens? }
//      → { ok: true, text, model, finish: 'stop' | 'length', usage? } | { ok: false, error, reason? }
//    { type: 'ai.cancel', id } → { ok: true, cancelled }
//  messages are lib/ai/request.js's (system → instructions; earlier turns → the transcript; the last user message → the
//  prompt; images as base64). schema is lib/ai/schema.js's subset, turned into a DynamicGenerationSchema so the model is
//  held to it; the answer goes back as JSON text and the worker checks it again. error is one of lib/ai/failure.js's
//  categories, or 'refusal'. Needs macOS or iOS 27; earlier systems answer unavailable ('os').
//

import Foundation
#if canImport(FoundationModels)
import FoundationModels
import CoreGraphics
import ImageIO
#endif

enum GlazeAI {
    /// The reply to `message` when it is one of ours (type ai.*), else nil.
    static func reply(to message: Any?) async -> [String: Any]? {
        guard let m = message as? [String: Any], let type = m["type"] as? String, type.hasPrefix("ai.") else { return nil }
        #if canImport(FoundationModels)
        if #available(macOS 27.0, iOS 27.0, *) {
            switch type {
            case "ai.status": return await Native.status(m)
            case "ai.run": return await Native.run(m)
            case "ai.cancel": return Native.cancel(m)
            default: return ["ok": false, "error": "request-rejected", "reason": "type"]
            }
        }
        #endif
        return type == "ai.status" ? ["ok": true, "state": "unavailable", "reason": "os"] : ["ok": false, "error": "provider-unavailable", "reason": "os"]
    }
}

#if canImport(FoundationModels)
@available(macOS 27.0, iOS 27.0, *)
private enum Native {
    // Glaze's own limits (lib/ai/request.js LIMIT): checked again here, since a message is data.
    static let maxMessages = 64, maxChars = 2_000_000, maxImages = 8, maxImageBytes = 6 << 20, maxSchemaDepth = 12

    // Runs in flight, by the worker's id, so ai.cancel can stop one. Only reaches a run in this same process.
    // JSON bytes cross task boundaries; dictionaries containing Any stay inside the task that decodes them.
    nonisolated(unsafe) private static var running: [String: Task<Data, Never>] = [:]
    // Safari may deliver the separate cancel message before the run registers. Keep a bounded, short-lived tombstone.
    nonisolated(unsafe) private static var cancelled: [String: Date] = [:]
    private static let lock = NSLock()

    static func cancel(_ m: [String: Any]) -> [String: Any] {
        guard let id = m["id"] as? String, !id.isEmpty, id.count <= 128 else { return ["ok": false, "error": "request-rejected", "reason": "id"] }
        let found = lock.withLock {
            if let task = running[id] { task.cancel(); return true }
            cancelled = cancelled.filter { $0.value > Date() }
            if cancelled.count >= 256, let oldest = cancelled.min(by: { $0.value < $1.value })?.key { cancelled[oldest] = nil }
            cancelled[id] = Date().addingTimeInterval(300)
            return false
        }
        return ["ok": true, "cancelled": found]
    }

    static func status(_ m: [String: Any]) async -> [String: Any] {
        switch m["model"] as? String {
        case "on-device":
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                return ["ok": true, "state": "ready", "context": model.contextSize, "images": model.capabilities.contains(.vision)]
            case .unavailable(.modelNotReady): return ["ok": true, "state": "downloading", "reason": "not-ready"]
            case .unavailable(.appleIntelligenceNotEnabled): return ["ok": true, "state": "unavailable", "reason": "off"]
            case .unavailable(.deviceNotEligible): return ["ok": true, "state": "unavailable", "reason": "device"]
            case .unavailable: return ["ok": true, "state": "unavailable", "reason": "unknown"]
            }
        case "private-cloud":
            let model = PrivateCloudComputeLanguageModel()
            switch model.availability {
            case .available:
                let quota: String
                switch model.quotaUsage.status {
                case .limitReached: quota = "reached"
                case .belowLimit(let below): quota = below.isApproachingLimit ? "near" : "ok"
                @unknown default: quota = "unknown"
                }
                // Availability (and even contextSize) can succeed without the PCC entitlement; inference then fails
                // with ModelManagerError 1046. Status sends no probe or user text, so it cannot promise readiness.
                return ["ok": true, "state": "unavailable", "reason": quota == "reached" ? "quota" : "unverified",
                        "unverified": true, "quota": quota, "images": model.capabilities.contains(.vision)]
            case .unavailable(.deviceNotEligible): return ["ok": true, "state": "unavailable", "reason": "device"]
            case .unavailable(.systemNotReady): return ["ok": true, "state": "unavailable", "reason": "not-ready"]
            case .unavailable: return ["ok": true, "state": "unavailable", "reason": "unknown"]
            }
        default:
            return ["ok": false, "error": "request-rejected", "reason": "model"]
        }
    }

    static func run(_ m: [String: Any]) async -> [String: Any] {
        guard let id = m["id"] as? String, !id.isEmpty, id.count <= 128 else { return ["ok": false, "error": "request-rejected", "reason": "id"] }
        guard let data = try? JSONSerialization.data(withJSONObject: m) else { return ["ok": false, "error": "request-rejected", "reason": "message"] }
        let admission: (task: Task<Data, Never>?, cancelled: Bool) = lock.withLock {
            cancelled = cancelled.filter { $0.value > Date() }
            if cancelled.removeValue(forKey: id) != nil { return (nil, true) }
            guard running[id] == nil else { return (nil, false) }
            let task = Task {
                let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                let reply = await respond(message)
                return (try? JSONSerialization.data(withJSONObject: reply)) ?? Data(#"{"ok":false,"error":"invalid-response"}"#.utf8)
            }
            running[id] = task
            return (task, false)
        }
        guard let task = admission.task else {
            return admission.cancelled ? ["ok": false, "error": "cancelled"] : ["ok": false, "error": "request-rejected", "reason": "duplicate"]
        }
        let dataOut = await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
        lock.withLock { running[id] = nil }
        return (try? JSONSerialization.jsonObject(with: dataOut)) as? [String: Any] ?? ["ok": false, "error": "invalid-response"]
    }

    private struct Refused: Error { let reason: String }

    private static func respond(_ m: [String: Any]) async -> [String: Any] {
        do {
            try Task.checkCancellation()
            let (instructions, history, prompt) = try conversation(m["messages"])
            var options = GenerationOptions()
            if let t = m["temperature"] as? Double, t >= 0, t <= 2 { options.temperature = t }
            if let n = m["maxTokens"] as? Int, n >= 1, n <= 32768 { options.maximumResponseTokens = n }
            let schema = try (m["schema"] as? [String: Any]).map { try GenerationSchema(root: Schema().node($0, name: "Answer", depth: 0), dependencies: []) }
            let session: LanguageModelSession
            let name: String
            var entries: [Transcript.Entry] = []
            if let instructions { entries.append(.instructions(Transcript.Instructions(segments: [.text(.init(content: instructions))], toolDefinitions: []))) }
            entries.append(contentsOf: history)
            switch m["model"] as? String {
            case "on-device":
                let model = SystemLanguageModel.default
                guard model.isAvailable else { return ["ok": false, "error": "provider-unavailable", "reason": "unavailable"] }
                session = LanguageModelSession(model: model, transcript: Transcript(entries: entries))
                name = model.variant.displayName
            case "private-cloud":
                let model = PrivateCloudComputeLanguageModel()
                guard model.isAvailable else { return ["ok": false, "error": "provider-unavailable", "reason": "unavailable"] }
                session = LanguageModelSession(model: model, transcript: Transcript(entries: entries))
                name = "Private Cloud Compute"
            default:
                return ["ok": false, "error": "request-rejected", "reason": "model"]
            }
            let text: String
            let usage: LanguageModelSession.Usage
            try Task.checkCancellation()
            if let schema {
                let r = try await session.respond(to: prompt, schema: schema, options: options)
                text = r.content.jsonString
                usage = r.usage
            } else {
                let r = try await session.respond(to: prompt, options: options)
                text = r.content
                usage = r.usage
            }
            if Task.isCancelled { return ["ok": false, "error": "cancelled"] }
            // At maximumResponseTokens guided generation still closes its JSON, cut short: say so, so it isn't read.
            let cut = options.maximumResponseTokens.map { usage.output.totalTokenCount >= $0 } ?? false
            return ["ok": true, "text": text, "model": name, "finish": cut ? "length" : "stop",
                    "usage": ["input": usage.input.totalTokenCount, "cached": usage.input.cachedTokenCount, "output": usage.output.totalTokenCount]]
        } catch let e as Refused {
            return Task.isCancelled ? ["ok": false, "error": "cancelled"] : ["ok": false, "error": "request-rejected", "reason": e.reason]
        } catch {
            return failure(error)
        }
    }

    /// An error as one of lib/ai/failure.js's categories (or 'refusal'), with a reason word for a developer.
    static func failure(_ error: Error) -> [String: Any] {
        if Task.isCancelled || error is CancellationError { return ["ok": false, "error": "cancelled"] }
        if let e = error as? LanguageModelError {
            switch e {
            case .contextSizeExceeded(let c): return ["ok": false, "error": "request-rejected", "reason": "context", "context": c.contextSize, "tokens": c.tokenCount]
            case .rateLimited: return ["ok": false, "error": "request-rejected", "reason": "rate", "status": 429]
            case .guardrailViolation: return ["ok": false, "error": "refusal", "reason": "guardrail"]
            case .refusal: return ["ok": false, "error": "refusal", "reason": "refusal"]
            case .unsupportedCapability, .unsupportedTranscriptContent, .unsupportedGenerationGuide: return ["ok": false, "error": "request-rejected", "reason": "unsupported"]
            case .unsupportedLanguageOrLocale: return ["ok": false, "error": "request-rejected", "reason": "language"]
            case .timeout: return ["ok": false, "error": "timeout"]
            @unknown default: break
            }
        }
        if let e = error as? PrivateCloudComputeLanguageModel.Error {
            switch e {
            case .networkFailure: return ["ok": false, "error": "connection-lost", "reason": "network"]
            case .quotaLimitReached: return ["ok": false, "error": "request-rejected", "reason": "quota", "status": 429]
            case .serviceUnavailable: return ["ok": false, "error": "provider-unavailable", "reason": "service"]
            @unknown default: break
            }
        }
        if error is SystemLanguageModel.Error { return ["ok": false, "error": "provider-unavailable", "reason": "assets"] }
        if error is GeneratedContent.ParsingError { return ["ok": false, "error": "invalid-response", "reason": "decoding"] }
        // Native error domains, descriptions and underlying errors can contain user text. Never send them back.
        return ["ok": false, "error": "provider-unavailable", "reason": "unknown"]
    }

    // ---- the conversation ----------------------------------------------------------------------------------------------

    private static func conversation(_ raw: Any?) throws -> (String?, [Transcript.Entry], Prompt) {
        guard let list = raw as? [[String: Any]], !list.isEmpty, list.count <= maxMessages else { throw Refused(reason: "messages") }
        var system: [String] = [], turns: [(role: String, parts: [[String: Any]])] = []
        var chars = 0, images = 0
        for msg in list {
            guard let role = msg["role"] as? String, let parts = msg["content"] as? [[String: Any]] else { throw Refused(reason: "message") }
            for p in parts {
                if let t = p["text"] as? String { chars += t.count } else if p["type"] as? String == "image" { images += 1 }
            }
            switch role {
            case "system": system.append(contentsOf: parts.compactMap { $0["text"] as? String })
            case "user", "assistant": turns.append((role, parts))
            default: throw Refused(reason: "role") // tools aren't offered: caps.tools is false
            }
        }
        guard chars <= maxChars, images <= maxImages, let last = turns.last, last.role == "user" else { throw Refused(reason: "size") }
        var history: [Transcript.Entry] = []
        for turn in turns.dropLast() {
            let segments = try turn.parts.map(segment)
            history.append(turn.role == "user" ? .prompt(Transcript.Prompt(segments: segments)) : .response(Transcript.Response(segments: segments)))
        }
        let pieces: [Prompt] = try last.parts.map { p in
            if let t = p["text"] as? String { return Prompt(t) }
            return Prompt(Attachment<ImageAttachmentContent>(try image(p)))
        }
        let prompt = Prompt { for piece in pieces { piece } }
        return (system.isEmpty ? nil : system.joined(separator: "\n\n"), history, prompt)
    }

    private static func segment(_ p: [String: Any]) throws -> Transcript.Segment {
        if let t = p["text"] as? String { return .text(.init(content: t)) }
        return .attachment(.init(content: .image(.init(try image(p)))))
    }

    private static func image(_ p: [String: Any]) throws -> CGImage {
        guard p["type"] as? String == "image", let b64 = p["data"] as? String, b64.count <= maxImageBytes * 4 / 3 + 4,
              let data = Data(base64Encoded: b64), let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw Refused(reason: "image") }
        return image
    }

    // ---- lib/ai/schema.js → DynamicGenerationSchema ---------------------------------------------------------------------

    private final class Schema {
        private var names = 0
        private func fresh(_ base: String) -> String { names += 1; return "\(base)\(names)" }

        func node(_ s: [String: Any], name: String, depth: Int) throws -> DynamicGenerationSchema {
            guard depth <= maxSchemaDepth else { throw Refused(reason: "schema") }
            let description = s["description"] as? String
            if let choices = s["anyOf"] as? [[String: Any]] {
                return DynamicGenerationSchema(name: fresh(name), description: description, anyOf: try choices.map { try node($0, name: name, depth: depth + 1) })
            }
            if let values = s["enum"] as? [String] { return DynamicGenerationSchema(name: fresh(name), description: description, anyOf: values) }
            if let value = s["const"] as? String { return DynamicGenerationSchema(name: fresh(name), description: description, anyOf: [value]) }
            var types = (s["type"] as? [String]) ?? [(s["type"] as? String) ?? ""]
            let nullable = types.contains("null")
            types.removeAll { $0 == "null" }
            if nullable && types.isEmpty { return .null }
            guard types.count == 1 else { throw Refused(reason: "schema type") }
            let inner: DynamicGenerationSchema
            switch types[0] {
            case "object":
                let props = (s["properties"] as? [String: Any]) ?? [:]
                let required = Set((s["required"] as? [String]) ?? [])
                // In the order the task wrote them: JSONSerialization's dictionary has none, so sort for a stable prompt.
                let properties = try props.keys.sorted().map { key -> DynamicGenerationSchema.Property in
                    guard let sub = props[key] as? [String: Any] else { throw Refused(reason: "schema property") }
                    return .init(name: key, description: sub["description"] as? String, schema: try node(sub, name: key.capitalized, depth: depth + 1), isOptional: !required.contains(key))
                }
                inner = DynamicGenerationSchema(name: fresh(name), description: description, representNilExplicitlyInGeneratedContent: true, properties: properties)
            case "array":
                let items = (s["items"] as? [String: Any]) ?? [:]
                inner = DynamicGenerationSchema(arrayOf: try node(items, name: name + "Item", depth: depth + 1), minimumElements: s["minItems"] as? Int, maximumElements: s["maxItems"] as? Int)
            case "string":
                inner = DynamicGenerationSchema(type: String.self)
            case "integer":
                var guides: [GenerationGuide<Int>] = []
                if let lo = s["minimum"] as? Int { guides.append(.minimum(lo)) }
                if let hi = s["maximum"] as? Int { guides.append(.maximum(hi)) }
                inner = DynamicGenerationSchema(type: Int.self, guides: guides)
            case "number":
                var guides: [GenerationGuide<Double>] = []
                if let lo = s["minimum"] as? Double { guides.append(.minimum(lo)) }
                if let hi = s["maximum"] as? Double { guides.append(.maximum(hi)) }
                inner = DynamicGenerationSchema(type: Double.self, guides: guides)
            case "boolean":
                inner = DynamicGenerationSchema(type: Bool.self)
            default:
                throw Refused(reason: "schema type")
            }
            return nullable ? DynamicGenerationSchema(name: fresh(name), anyOf: [inner, .null]) : inner
        }
    }
}
#endif
