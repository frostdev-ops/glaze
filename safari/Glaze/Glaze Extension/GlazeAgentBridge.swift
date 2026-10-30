//
//  GlazeAgentBridge.swift
//  Glaze Extension
//
//  Agent access in Safari, the DMG build's extension side (the contract is in the header of lib/agent-link.js). The worker
//  sends batches { type: 'agent.frames', i, s, seq, frames } through browser.runtime.sendNativeMessage; each is checked,
//  handed whole to the Glaze app (safari/dmg/GlazeAgentHost.swift) over the app group's socket, and answered with the app's
//  { ok: true } or { ok: false, error }. When the app isn't running, a batch that starts a session (its hello) opens it,
//  hidden, through its private URL; any other batch hears that the app has gone, so the worker starts over. The app talks
//  to the worker through dispatchMessage, never through here.
//  The group channel: a connection per batch, one message each way, framed as native messaging is (a 32-bit little-endian
//  length, then UTF-8 JSON) and at most `GlazeAgentBridge.cap` bytes; each end refuses another user's process.
//  GlazeAgentFrames is lib/agent-frames.js's shapes and sizes, shared with the app (test/agent-bridge-native.test.js runs
//  both on test/fixtures/agent-frames.json).
//  Only scripts/stage-safari-dmg.py adds this file to a build (the Mac extension and the app), and only with GLAZE_DMG: the
//  App Store build has none of it, so agent.* gets the handler's echo, which the worker reads as not installed.
//
#if os(macOS) && GLAZE_DMG
import Foundation
import Darwin
import Security

/// lib/agent-frames.js: the exact shapes each side may send, a line cut into pieces, and a frame's size as JSON.stringify
/// writes it. Values are as JSONSerialization or Safari give them: NSNumber, NSString, arrays and dictionaries.
nonisolated enum GlazeAgentFrames {
    static let piece = 160_000, frame = 1_000_000, line = 64 << 20, string = 4096
    /// The longest native message read (mcp/lib/native.js MAX_IN).
    static let nativeIn = 64 << 20
    static let safe = 9_007_199_254_740_991

    nonisolated enum Kind: Sendable { case str, piece, conn, whole, one, bool, peer }
    typealias Shape = (need: [String: Kind], may: [String: Kind])
    private static let lineShape: Shape = (["c": .conn, "d": .piece], ["m": .one])
    private static let closeShape: Shape = (["c": .conn, "why": .str], [:])
    static let fromHost: [String: Shape] = [
        "hello": (["v": .one, "host": .str, "os": .str, "browser": .str, "node": .str], [:]),
        "open": (["c": .conn, "peer": .peer], [:]), "line": lineShape, "close": closeShape, "error": (["why": .str], [:]),
    ]
    static let fromWorker: [String: Shape] = [
        "hello": (["v": .one, "glaze": .str, "instance": .str], [:]), "line": lineShape, "close": closeShape, "bye": ([:], [:]),
    ]

    /// f rebuilt from its checked values when the host may send it to the worker (toWorker) or the worker to the host
    /// (toHost); else nil. A lone surrogate in a string comes back as U+FFFD, as the Node host writes it to an agent.
    static func toWorker(_ f: Any?) -> [String: Any]? { shape(f, fromHost) }
    static func toHost(_ f: Any?) -> [String: Any]? { shape(f, fromWorker) }

    private static func shape(_ f: Any?, _ table: [String: Shape]) -> [String: Any]? {
        guard var o = f as? [String: Any], let t = o.removeValue(forKey: "t") as? String, let s = table[t],
              var out = fit(o, s.need, s.may) else { return nil }
        out["t"] = t
        return out
    }
    /// Exactly these keys: all of need and any of may, each of its kind.
    private static func fit(_ v: Any?, _ need: [String: Kind], _ may: [String: Kind]) -> [String: Any]? {
        guard let o = v as? [String: Any] else { return nil }
        var out: [String: Any] = [:]
        for (k, x) in o {
            guard let kind = need[k] ?? may[k], let clean = value(x, kind) else { return nil }
            out[k] = clean
        }
        return need.keys.allSatisfy { out[$0] != nil } ? out : nil
    }
    private static func value(_ v: Any, _ kind: Kind) -> Any? {
        switch kind {
        case .str, .piece:
            guard let s = v as? String else { return nil }
            let u = Array(s.utf16)
            return u.count <= (kind == .str ? string : piece) ? String(decoding: u, as: UTF16.self) : nil
        case .conn: return whole(v).flatMap { $0 > 0 ? $0 : nil }
        case .whole: return whole(v).flatMap { $0 >= 0 ? $0 : nil }
        case .one: return whole(v) == 1 ? 1 : nil
        case .bool: return bool(v)
        case .peer: return fit(v, ["verified": .bool], ["name": .str, "exe": .str, "ppid": .whole])
        }
    }

    /// A JSON boolean (CFBoolean; NSNumber 1 is not one).
    static func bool(_ v: Any?) -> Bool? {
        guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
    /// A JSON number that is a safe integer, as Number.isSafeInteger takes it.
    static func whole(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d.isFinite, d.rounded(.towardZero) == d, abs(d) <= Double(safe), Double(n.int64Value) == d else { return nil }
        return Int(n.int64Value)
    }

    static func high(_ u: UInt16) -> Bool { u >= 0xD800 && u <= 0xDBFF }
    static func low(_ u: UInt16) -> Bool { u >= 0xDC00 && u <= 0xDFFF }

    /// A line's frames: pieces of at most `piece` UTF-16 units, never cut inside a surrogate pair, all but the last m:1.
    static func split(_ c: Int, _ units: [UInt16]) -> [[String: Any]] {
        var out: [[String: Any]] = [], at = 0
        repeat {
            var end = min(at + piece, units.count)
            if end < units.count, high(units[end - 1]), low(units[end]) { end -= 1 }
            var f: [String: Any] = ["t": "line", "c": c, "d": NSString(characters: Array(units[at..<end]), length: end - at)]
            if end < units.count { f["m"] = 1 }
            out.append(f)
            at = end
        } while at < units.count
        return out
    }

    /// The UTF-8 bytes of JSON.stringify(v), for what frames hold: dictionaries, arrays, strings, whole numbers, booleans.
    static func size(_ v: Any) -> Int {
        if let n = v as? NSNumber {
            return CFGetTypeID(n) == CFBooleanGetTypeID() ? (n.boolValue ? 4 : 5) : String(n.int64Value).utf8.count
        }
        if let s = v as? NSString {
            var u = [UInt16](repeating: 0, count: s.length)
            s.getCharacters(&u, range: NSRange(location: 0, length: s.length))
            return size(units: u)
        }
        if let a = v as? [Any] { return 1 + max(a.count, 1) + a.reduce(0) { $0 + size($1) } }
        if let o = v as? [String: Any] { return 1 + max(o.count, 1) + o.reduce(0) { $0 + size($1.key as NSString) + 1 + size($1.value) } }
        return 4
    }
    /// A string's: escaped as JSON.stringify escapes (controls, quote, backslash, a lone surrogate), the rest as UTF-8.
    static func size(units u: [UInt16]) -> Int {
        var n = 2, i = 0
        while i < u.count {
            switch u[i] {
            case 0x22, 0x5C, 0x08, 0x09, 0x0A, 0x0C, 0x0D: n += 2
            case 0..<0x20: n += 6
            case 0x20..<0x80: n += 1
            case 0x80..<0x800: n += 2
            case 0xD800...0xDBFF where i + 1 < u.count && low(u[i + 1]): n += 4; i += 1
            case 0xD800...0xDFFF: n += 6
            default: n += 3
            }
            i += 1
        }
        return n
    }

    // Native messaging's framing (mcp/lib/native.js), here for the group channel.
    nonisolated enum Refusal: Error, Sendable {
        case tooLarge, empty, badJSON
        var code: String {
            switch self {
            case .tooLarge: "too-large"
            case .empty: "empty"
            case .badJSON: "bad-json"
            }
        }
    }
    /// m as one message: its length, then its JSON; nil when it isn't JSON or its JSON is over max bytes.
    static func encode(_ m: Any, max: Int = frame) -> Data? {
        guard JSONSerialization.isValidJSONObject(m),
              let json = try? JSONSerialization.data(withJSONObject: m, options: [.withoutEscapingSlashes]), json.count <= max else { return nil }
        let n = UInt32(json.count)
        return Data([UInt8(n & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 24)]) + json
    }
    /// A message's body, as native.js takes it: strict UTF-8 (no overlong form, surrogate or past U+10FFFF), then JSON.
    static func decode(_ body: [UInt8]) throws -> Any {
        guard utf8(body), let m = try? JSONSerialization.jsonObject(with: Data(body), options: [.fragmentsAllowed]) else { throw Refusal.badJSON }
        return m
    }
    static func utf8(_ b: [UInt8]) -> Bool {
        var i = 0
        while i < b.count {
            let c = b[i]
            let n = c < 0x80 ? 0 : c < 0xC2 ? -1 : c < 0xE0 ? 1 : c < 0xF0 ? 2 : c < 0xF5 ? 3 : -1
            guard n >= 0, i + n < b.count else { return false }
            if n > 0 {
                let d = b[i + 1]
                if c == 0xE0 && d < 0xA0 || c == 0xED && d > 0x9F || c == 0xF0 && d < 0x90 || c == 0xF4 && d > 0x8F { return false }
                for k in 1...n where b[i + k] & 0xC0 != 0x80 { return false }
            }
            i += n + 1
        }
        return true
    }
    /// Messages from a stream: push each chunk and get each message once all of it is in. A length over max, a zero
    /// length or a body that isn't UTF-8 JSON throws, and so does every push after it.
    nonisolated struct Reader {
        let max: Int
        private var buf: [UInt8] = [], need = -1, dead: Refusal?
        init(max: Int = GlazeAgentFrames.nativeIn) { self.max = max }
        mutating func push(_ chunk: [UInt8], _ each: (Any) -> Void) throws {
            if let dead { throw dead }
            buf += chunk
            while true {
                if need < 0 {
                    guard buf.count >= 4 else { return }
                    let n = Int(buf[0]) | Int(buf[1]) << 8 | Int(buf[2]) << 16 | Int(buf[3]) << 24
                    buf.removeFirst(4)
                    if n > max { dead = .tooLarge } else if n == 0 { dead = .empty }
                    if let dead { throw dead }
                    need = n
                }
                guard buf.count >= need else { return }
                let body = Array(buf[0..<need])
                buf.removeFirst(need)
                need = -1
                do { each(try GlazeAgentFrames.decode(body)) } catch { dead = .badJSON; throw Refusal.badJSON }
            }
        }
    }
}

/// The extension's end of the group channel.
nonisolated enum GlazeAgentBridge {
    /// The app's private URL that starts it hidden for agents, and its socket in the group container.
    static let start = "io.frostdev.glaze-agent://start"
    static let socket = "agent.sock"
    /// The most either end writes: a batch holds at most a frame's bytes of frames, plus its envelope.
    static let cap = 2 * GlazeAgentFrames.frame
    static let timeout: TimeInterval = 10

    /// The app group's container, from this process's own entitlement; nil without one.
    static func folder() -> URL? {
        guard let task = SecTaskCreateFromSelf(nil),
              let groups = SecTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil) as? [String],
              groups.count == 1 else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groups[0])
    }

    /// The worker's batch rebuilt from exactly its keys, each of its shape, or nil.
    static func batch(_ m: Any?) -> [String: Any]? {
        guard let o = m as? [String: Any], Set(o.keys) == ["type", "i", "s", "seq", "frames"], o["type"] as? String == "agent.frames",
              let i = o["i"] as? String, hex(i, 20), let s = o["s"] as? String, hex(s, 32),
              let seq = GlazeAgentFrames.whole(o["seq"]), seq > 0, let list = o["frames"] as? [Any] else { return nil }
        var frames: [[String: Any]] = [], bytes = 0
        for f in list {
            guard let g = GlazeAgentFrames.toHost(f) else { return nil }
            frames.append(g)
            bytes += GlazeAgentFrames.size(g)
        }
        guard frames.count <= 1 || bytes <= GlazeAgentFrames.frame else { return nil }
        return ["type": "agent.frames", "i": i, "s": s, "seq": seq, "frames": frames]
    }
    static func hex(_ s: String, _ n: Int) -> Bool { s.utf8.count == n && s.utf8.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) } }

    /// What the worker hears for message: the app's answer, or why there is none. folder: the group container (nil: this
    /// build has no group); launch: opens the app hidden, called only for a batch that starts with a hello.
    static func reply(to message: Any?, folder: URL?, wait: TimeInterval = timeout, launch: () -> Void) -> [String: Any] {
        guard let b = batch(message) else { return refused("bad-batch") }
        guard let folder else { return refused("not-installed") }
        let path = folder.appendingPathComponent(socket).path
        var fd = connect(path)
        if fd < 0, ((b["frames"] as? [[String: Any]])?.first?["t"] as? String) == "hello" {
            launch()
            let until = Date().addingTimeInterval(wait)
            while fd < 0, Date() < until {
                usleep(50_000)
                fd = connect(path)
            }
            if fd < 0 { return refused("the Glaze app didn't start") }
        }
        guard fd >= 0 else { return refused("the Glaze app isn't running") }
        defer { Darwin.close(fd) }
        guard let out = GlazeAgentFrames.encode(b, max: cap), write(fd, out), let r = read(fd) else { return refused("the Glaze app didn't answer") }
        return answer(r)
    }
    /// The app's answer, passed on only in the two shapes the worker reads.
    static func answer(_ r: Any) -> [String: Any] {
        if let o = r as? [String: Any], let ok = GlazeAgentFrames.bool(o["ok"]) {
            if ok, o.count == 1 { return ["ok": true] }
            if !ok, o.count == 2, let e = o["error"] as? String, !e.isEmpty, e.utf16.count <= 200 { return refused(e) }
        }
        return refused("unexpected reply from the Glaze app")
    }
    static func refused(_ why: String) -> [String: Any] { ["ok": false, "error": why] }

    /// A connection to the unix socket at path, owned by this user, with timeouts both ways; -1 when there is none.
    static func connect(_ path: String, timeout: TimeInterval = timeout) -> Int32 {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return -1 }
        options(fd, timeout: timeout)
        let done = addressed(path) { addr in
            var addr = addr
            return withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
        }
        var uid: uid_t = 0, gid: gid_t = 0
        guard done == 0, getpeereid(fd, &uid, &gid) == 0, uid == getuid() else { Darwin.close(fd); return -1 }
        return fd
    }
    /// Long group-container paths are reached by name inside a pinned directory, as rendezvous.js does for run sockets.
    /// All our temporary working-directory changes share this lock; no asynchronous work runs in this scope.
    private static let paths = NSLock()
    static func inside<T>(_ dir: Int32, _ body: () throws -> T) rethrows -> T? {
        paths.lock()
        defer { paths.unlock() }
        let was = Darwin.open(".", O_RDONLY | O_DIRECTORY)
        guard was >= 0 else { return nil }
        defer { _ = fchdir(was); Darwin.close(was) }
        var a = stat(), b = stat()
        guard fstat(dir, &a) == 0, fchdir(dir) == 0, stat(".", &b) == 0, a.st_dev == b.st_dev, a.st_ino == b.st_ino else { return nil }
        return try body()
    }
    static func addressed<T>(_ path: String, _ use: (sockaddr_un) -> T) -> T? {
        if let addr = address(path) { return use(addr) }
        let url = URL(fileURLWithPath: path)
        guard let addr = address(url.lastPathComponent) else { return nil }
        let dir = Darwin.open(url.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard dir >= 0 else { return nil }
        defer { Darwin.close(dir) }
        var st = stat()
        guard fstat(dir, &st) == 0, st.st_uid == getuid() else { return nil }
        return inside(dir) { use(addr) }
    }
    /// A socket address for path; nil when it doesn't fit sun_path with its NUL.
    static func address(_ path: String) -> sockaddr_un? {
        var a = sockaddr_un()
        let bytes = Array(path.utf8)
        guard !bytes.isEmpty, bytes.count < MemoryLayout.size(ofValue: a.sun_path) else { return nil }
        a.sun_family = sa_family_t(AF_UNIX)
        a.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &a.sun_path) { $0.copyBytes(from: bytes) }
        return a
    }
    /// No SIGPIPE, and blocking reads and writes that give up after timeout.
    static func options(_ fd: Int32, timeout: TimeInterval) {
        var one: Int32 = 1, tv = timeval(tv_sec: Int(timeout), tv_usec: Int32(timeout.truncatingRemainder(dividingBy: 1) * 1e6))
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    }
    static func write(_ fd: Int32, _ data: Data) -> Bool {
        let bytes = [UInt8](data)
        var at = 0
        while at < bytes.count {
            let n = bytes[at...].withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
            if n < 0 && errno == EINTR { continue }
            guard n > 0 else { return false }
            at += n
        }
        return true
    }
    /// The one message the other end writes, or nil (closed, refused, or nothing in time).
    static func read(_ fd: Int32) -> Any? {
        var reader = GlazeAgentFrames.Reader(max: cap), got: Any?, chunk = [UInt8](repeating: 0, count: 65536)
        while got == nil {
            let n = chunk.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if n < 0 && errno == EINTR { continue }
            guard n > 0, (try? reader.push(Array(chunk[0..<n]), { m in if got == nil { got = m } })) != nil else { return nil }
        }
        return got
    }
}
#endif
