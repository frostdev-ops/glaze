//
//  GlazeAgentHost.swift
//  Glaze (DMG)
//
//  The Glaze app as Safari's agent host (the contract is in the header of lib/agent-link.js). For each Safari profile's
//  worker, by its instance i, it does what mcp/lib/host.js does for Chrome and Firefox: at the worker's hello it publishes
//  <run>/safari.<i>.sock and its run file (mcp/lib/rendezvous.js's folder, names, modes and lock), lets in each agent that
//  proves the token (mcp/lib/handshake.js) as a numbered connection, and passes lines both ways as frames, with mux.js's
//  limits. Unlike that host it outlives the worker: batches come a session (s) at a time over the app group's socket from
//  GlazeAgentBridge.swift, frames go back through dispatchMessage, and after each new session's hello every live
//  connection is announced again, so the worker can carry on with it. Between sessions agents' reads wait.
//  An agent's peer is the program that started it, as the kernel says (LOCAL_PEERPID), so it is verified.
//  Everything runs on the main queue. onIdle comes once no worker has sent a batch for limits.idle (10 minutes); bye ends
//  that worker's connections, socket and run file.
//  Only scripts/stage-safari-dmg.py adds this file to a build: the DMG app's.
//
#if os(macOS) && GLAZE_DMG
import Foundation
import Darwin
import CryptoKit
import SafariServices

@MainActor
final class GlazeAgentHost {
    /// Hands frames to the worker ({i, s, frames} as dispatchMessage's userInfo); done(false) when Safari didn't take them.
    typealias Dispatch = (_ info: [String: Any], _ done: @escaping @MainActor (Bool) -> Void) -> Void
    /// idle: no batch from any worker for this long and onIdle comes; hello: handshake.js's TIMEOUT; drain: how long an
    /// agent the worker closed has to read what it was sent; line, queue: lines.js's LINE and QUEUE; high: the frames
    /// waiting for Safari past which agents' reads wait.
    nonisolated struct Limits: Sendable {
        var idle: TimeInterval = 600, hello: TimeInterval = 5, drain: TimeInterval = 10
        var line = GlazeAgentFrames.line, queue = 32 << 20, high = 4 * GlazeAgentFrames.frame
    }
    static let helloMax = 64 * 1024

    let run: String, group: String, version: String, limits: Limits
    private let dispatch: Dispatch
    var onIdle: (() -> Void)?
    private var listener: (source: DispatchSourceRead, ino: UInt64)?
    private var timer: DispatchSourceTimer?
    private var instances: [String: Instance] = [:]
    private var last = Date()
    // Connection numbers start at the launch time in ms, so a relaunched app never repeats one a worker kept.
    private var next = Int(Date().timeIntervalSince1970 * 1000)
    private var chunk = [UInt8](repeating: 0, count: 65536)

    /// run: mcp/lib/rendezvous.js's folder; group: the app group's container.
    init(run: String, group: String, version: String, limits: Limits = Limits(), dispatch: @escaping Dispatch) {
        self.run = run
        self.group = group
        self.version = version
        self.limits = limits
        self.dispatch = dispatch
    }

    /// The app's: its group container, the user's run folder, dispatchMessage to its own extension; nil without the group.
    static func safari() -> GlazeAgentHost? {
        guard let group = GlazeAgentBridge.folder(), let plugins = Bundle.main.builtInPlugInsURL,
              let ext = Bundle(url: plugins.appendingPathComponent("Glaze Extension.appex"))?.bundleIdentifier else { return nil }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return GlazeAgentHost(run: runFolder(), group: group.path, version: version) { info, done in
            SFSafariApplication.dispatchMessage(withName: "agent.frames", toExtensionWithIdentifier: ext, userInfo: info) { error in
                let ok = error == nil
                DispatchQueue.main.async { done(ok) }
            }
        }
    }
    /// rendezvous.js dir() on macOS.
    static func runFolder(home: String = NSHomeDirectory()) -> String {
        URL(fileURLWithPath: home).appendingPathComponent("Library/Application Support/glaze-mcp/run").standardizedFileURL.path
    }

    @MainActor private final class Instance {
        let id: String
        var session: String?, seq = 0, gen = 0, ended: (s: String, why: String)?
        var token = "", key: [UInt8] = [], ino: UInt64 = 0, listener: DispatchSourceRead?
        var conns: [Int: Conn] = [:], joining: [ObjectIdentifier: Conn] = [:]
        // Frames for Safari with their sizes, from head; waiting: their bytes.
        var out: [([String: Any], Int)] = [], head = 0, waiting = 0, flying = false
        init(_ id: String) { self.id = id }
        var base: String { "safari.\(id)" }
    }
    @MainActor private final class Conn {
        enum State { case hello, open, ending, dead }
        let fd: Int32, pid: pid_t, inst: Instance
        var state = State.hello, c = 0, peer: [String: Any] = [:]
        var hello: [UInt8] = [], parts: [UInt8] = [], toAgent = 0
        var read: DispatchSourceRead?, write: DispatchSourceWrite?, paused = false, sources = 0
        var buffer: [UInt8] = [], at = 0, deadline = 0
        init(fd: Int32, pid: pid_t, inst: Instance) { self.fd = fd; self.pid = pid; self.inst = inst }
        var queued: Int { buffer.count - at }
    }

    // MARK: The group channel

    /// Listens for the bridge; false when the group socket can't be had (another app has it, or its path is too long).
    @discardableResult func start() -> Bool {
        guard listener == nil else { return true }
        last = Date()
        let path = group + "/" + GlazeAgentBridge.socket
        guard let (fd, ino) = listenGroup(path) else { return false }
        listener = (accepting(fd) { [weak self] client, _ in
            guard let self else { Darwin.close(client); return }
            self.batch(client)
        }, ino)
        let every = min(max(limits.idle / 10, 0.05), 30), t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + every, repeating: every)
        t.setEventHandler { [weak self] in
            guard let self, Date().timeIntervalSince(self.last) >= self.limits.idle else { return }
            self.timer?.cancel()
            self.timer = nil
            self.onIdle?()
        }
        t.resume()
        timer = t
        return true
    }

    /// Everything ends: every worker's connections, sockets and run files, and the group socket.
    func stop() {
        for x in Array(instances.values) { stop(x) }
        timer?.cancel()
        timer = nil
        guard let (source, ino) = listener else { return }
        listener = nil
        source.cancel()
        let path = group + "/" + GlazeAgentBridge.socket
        var st = stat()
        if lstat(path, &st) == 0, st.st_mode & S_IFMT == S_IFSOCK, UInt64(st.st_ino) == ino { unlink(path) }
    }

    /// A socket listening at path, 0600; one an app that has gone left is replaced, a live one is not.
    private func listenGroup(_ path: String) -> (Int32, UInt64)? {
        var st = stat()
        if lstat(path, &st) == 0 {
            guard st.st_mode & S_IFMT == S_IFSOCK else { return nil }
            let other = GlazeAgentBridge.connect(path, timeout: 1)
            if other >= 0 { Darwin.close(other); return nil }
            unlink(path)
        }
        guard var addr = GlazeAgentBridge.address(path) else { return nil }
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        let mask = umask(0o177)
        let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        umask(mask)
        guard bound == 0, Darwin.listen(fd, 16) == 0, lstat(path, &st) == 0 else { Darwin.close(fd); return nil }
        return (fd, UInt64(st.st_ino))
    }

    /// Accepts on fd from the main queue: each client of this user, non-blocking and without SIGPIPE, with its pid.
    private func accepting(_ fd: Int32, _ each: @escaping (Int32, pid_t) -> Void) -> DispatchSourceRead {
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        source.setEventHandler {
            while true {
                let client = Darwin.accept(fd, nil, nil)
                if client < 0 { if errno == EINTR { continue }; return }
                var uid: uid_t = 0, gid: gid_t = 0, pid: pid_t = 0, len = socklen_t(MemoryLayout<pid_t>.size)
                guard getpeereid(client, &uid, &gid) == 0, uid == getuid(),
                      getsockopt(client, SOL_LOCAL, LOCAL_PEERPID, &pid, &len) == 0 else { Darwin.close(client); continue }
                var one: Int32 = 1
                setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
                _ = fcntl(client, F_SETFL, fcntl(client, F_GETFL) | O_NONBLOCK)
                each(client, pid)
            }
        }
        source.setCancelHandler { Darwin.close(fd) }
        source.resume()
        return source
    }

    /// One batch from the bridge, answered, then the connection closes; nothing in time closes it unanswered.
    private func batch(_ fd: Int32) {
        @MainActor final class One { var reader = GlazeAgentFrames.Reader(max: GlazeAgentBridge.cap), done = false }
        let one = One(), source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        let finish = { (reply: [String: Any]?) in
            guard !one.done else { return }
            one.done = true
            if let reply, let data = GlazeAgentFrames.encode(reply) { _ = GlazeAgentBridge.write(fd, data) }
            source.cancel()
        }
        source.setEventHandler { [weak self] in
            guard let self else { return finish(nil) }
            let n = self.chunk.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if n < 0, errno == EAGAIN || errno == EINTR { return }
            guard n > 0 else { return finish(nil) }
            var got: Any?
            do { try one.reader.push(Array(self.chunk[0..<n])) { m in if got == nil { got = m } } } catch { return finish(nil) }
            if let got { finish(self.take(got)) }
        }
        source.setCancelHandler { Darwin.close(fd) }
        source.resume()
        DispatchQueue.main.asyncAfter(deadline: .now() + GlazeAgentBridge.timeout) { finish(nil) }
    }

    /// The answer to a batch, acted on: a hello at seq 1 starts a session for its instance; any other batch must be the
    /// session's next.
    private func take(_ m: Any) -> [String: Any] {
        guard let b = GlazeAgentBridge.batch(m), let i = b["i"] as? String, let s = b["s"] as? String, let seq = b["seq"] as? Int,
              let frames = b["frames"] as? [[String: Any]] else { return GlazeAgentBridge.refused("bad-batch") }
        last = Date()
        if seq == 1, frames.first?["t"] as? String == "hello" {
            guard frames[0]["instance"] as? String == i else { return GlazeAgentBridge.refused("bad-batch") }
            let x = instances[i] ?? Instance(i)
            instances[i] = x
            begin(x, s)
            return apply(x, frames.dropFirst())
        }
        guard let x = instances[i], x.session == s else {
            if let e = instances[i]?.ended, e.s == s { return GlazeAgentBridge.refused(e.why) }
            return GlazeAgentBridge.refused("this session has ended")
        }
        guard seq == x.seq + 1 else {
            end(x, "a batch out of order")
            return GlazeAgentBridge.refused("a batch out of order")
        }
        x.seq = seq
        return apply(x, frames[...])
    }
    private func apply(_ x: Instance, _ frames: ArraySlice<[String: Any]>) -> [String: Any] {
        for f in frames {
            switch f["t"] as? String {
            case "line": toAgent(x, f)
            case "close": closed(x, f["c"] as? Int ?? 0)
            case "bye":
                stop(x)
                return ["ok": true]
            default:
                end(x, "a hello inside a session")
                return GlazeAgentBridge.refused("a hello inside a session")
            }
        }
        return ["ok": true]
    }

    // MARK: Sessions

    private func begin(_ x: Instance, _ s: String) {
        x.gen += 1
        x.session = s
        x.seq = 1
        x.ended = nil
        x.out = []; x.head = 0; x.waiting = 0; x.flying = false
        send(x, ["t": "hello", "v": 1, "host": String(version.prefix(GlazeAgentFrames.string)), "os": "darwin", "browser": "safari", "node": ""])
        if x.listener == nil, let why = publish(x) {
            NSLog("Glaze agents: %@", why)
            send(x, ["t": "error", "why": String(why.prefix(GlazeAgentFrames.string))])
        }
        for k in x.conns.values.sorted(by: { $0.c < $1.c }) where k.state == .open { send(x, ["t": "open", "c": k.c, "peer": k.peer]) }
        for k in x.conns.values { resume(k) }
    }
    /// The session is over: what waited for Safari goes, and agents' reads wait for the next.
    private func end(_ x: Instance, _ why: String) {
        guard let s = x.session else { return }
        x.ended = (s, why)
        x.session = nil
        x.gen += 1
        x.out = []; x.head = 0; x.waiting = 0; x.flying = false
        for k in x.conns.values { pause(k) }
    }
    /// The worker's bye: its connections close and its socket and run file go.
    private func stop(_ x: Instance) {
        instances[x.id] = nil
        x.session = nil
        x.gen += 1
        for k in Array(x.conns.values) + Array(x.joining.values) { shut(k) }
        x.conns = [:]
        x.listener?.cancel()
        x.listener = nil
        guard x.ino != 0, let dir = try? Run.open(run) else { return }
        defer { Darwin.close(dir) }
        try? Run.locked(dir) {
            let file = "\(x.base).json", sock = "\(x.base).sock"
            if let r = Run.json(dir, file) {
                guard r["token"] as? String == x.token else { return }
                unlinkat(dir, file, 0)
            }
            var st = stat()
            if fstatat(dir, sock, &st, AT_SYMLINK_NOFOLLOW) == 0, st.st_mode & S_IFMT == S_IFSOCK, UInt64(st.st_ino) == x.ino { unlinkat(dir, sock, 0) }
        }
    }

    private func send(_ x: Instance, _ f: [String: Any]) {
        guard x.session != nil else { return }
        let n = GlazeAgentFrames.size(f)
        x.out.append((f, n))
        x.waiting += n
        flush(x)
    }
    /// The waiting frames to Safari in batches of at most a frame's bytes, one in flight.
    private func flush(_ x: Instance) {
        guard !x.flying, let s = x.session, x.head < x.out.count else { return }
        var frames: [[String: Any]] = [], n = 0
        while x.head < x.out.count {
            let (f, b) = x.out[x.head]
            if !frames.isEmpty && n + b > GlazeAgentFrames.frame { break }
            frames.append(f)
            n += b
            x.head += 1
        }
        if x.head == x.out.count { x.out = []; x.head = 0 } else if x.head > 4096 { x.out.removeFirst(x.head); x.head = 0 }
        x.waiting -= n
        x.flying = true
        let g = x.gen
        dispatch(["i": x.id, "s": s, "frames": frames]) { [weak self, weak x] ok in
            guard let self, let x, x.gen == g else { return }
            x.flying = false
            guard ok else { return self.end(x, "Safari didn't take the app's message") }
            self.flush(x)
            if x.waiting <= self.limits.high { for k in x.conns.values { self.resume(k) } }
        }
    }

    // MARK: Agents

    /// x's socket and run file, as rendezvous.js's claim, listen and write; nil, or why not.
    private func publish(_ x: Instance) -> String? {
        do {
            let dir = try Run.open(run)
            defer { Darwin.close(dir) }
            let file = "\(x.base).json", sock = "\(x.base).sock", path = "\(run)/\(sock)"
            guard sock.utf8.count < 104, var addr = GlazeAgentBridge.address(sock) else { throw Run.Refused("socket name exceeds 103 bytes") }
            try Run.locked(dir) {
                var st = stat()
                let has = fstatat(dir, sock, &st, AT_SYMLINK_NOFOLLOW) == 0, r = Run.json(dir, file, private: false)
                let known = Run.record(r, run: run, base: x.base) != nil
                if has && (st.st_mode & S_IFMT != S_IFSOCK || !known) { throw Run.Refused("\(path) is already claimed") }
                if !known, let pid = GlazeAgentFrames.whole(r?["pid"]), pid > 0, Run.alive(pid) { throw Run.Refused("\(path) belongs to a live host") }
                if has { unlinkat(dir, sock, 0) }
                unlinkat(dir, file, 0)
            }
            let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
            guard fd >= 0 else { throw Run.Refused("no socket") }
            var ino: UInt64 = 0
            do {
                // Bound by its name inside the pinned folder, as rendezvous.js reach() does: a full path may not fit.
                try Run.inside(dir) {
                    let mask = umask(0o177)
                    defer { umask(mask) }
                    let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
                    guard bound == 0, Darwin.listen(fd, 16) == 0 else { throw Run.Refused("\(path) could not be bound") }
                }
                var st = stat()
                guard fstatat(dir, sock, &st, AT_SYMLINK_NOFOLLOW) == 0, st.st_mode & S_IFMT == S_IFSOCK else { throw Run.Refused("\(path) is not our socket") }
                ino = UInt64(st.st_ino)
            } catch {
                Darwin.close(fd)
                throw error
            }
            var key = [UInt8](repeating: 0, count: 32)
            do {
                guard SecRandomCopyBytes(kSecRandomDefault, key.count, &key) == errSecSuccess else { throw Run.Refused("no random bytes") }
                let token = Data(key).base64EncodedString()
                let record: [String: Any] = ["v": 1, "pid": Int(getpid()), "path": path, "token": token, "browser": "safari", "instance": x.id,
                                             "at": Int(Date().timeIntervalSince1970 * 1000)]
                try Run.locked(dir) {
                    if let old = Run.json(dir, file, private: false), let pid = GlazeAgentFrames.whole(old["pid"]), pid > 0, pid != Int(getpid()),
                       Run.alive(pid) { throw Run.Refused("another live host owns this run file") }
                    var st = stat()
                    guard fstatat(dir, sock, &st, AT_SYMLINK_NOFOLLOW) == 0, st.st_mode & S_IFMT == S_IFSOCK, UInt64(st.st_ino) == ino else {
                        throw Run.Refused("the bound socket was replaced before publication")
                    }
                    try Run.put(dir, file, try JSONSerialization.data(withJSONObject: record, options: [.withoutEscapingSlashes]))
                }
                x.key = key; x.token = token; x.ino = ino
            } catch {
                var st = stat()
                if fstatat(dir, sock, &st, AT_SYMLINK_NOFOLLOW) == 0, st.st_mode & S_IFMT == S_IFSOCK, UInt64(st.st_ino) == ino { unlinkat(dir, sock, 0) }
                Darwin.close(fd)
                throw error
            }
            x.listener = accepting(fd) { [weak self, weak x] client, pid in
                guard let self, let x else { Darwin.close(client); return }
                self.admit(x, client, pid)
            }
            return nil
        } catch let e as Run.Refused {
            return e.why
        } catch {
            return "\(error)"
        }
    }

    private func admit(_ x: Instance, _ fd: Int32, _ pid: pid_t) {
        let k = Conn(fd: fd, pid: pid, inst: x)
        x.joining[ObjectIdentifier(k)] = k
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        k.sources += 1
        source.setEventHandler { [weak self] in self?.readable(k) }
        source.setCancelHandler { k.sources -= 1; if k.sources == 0 { Darwin.close(fd) } }
        k.read = source
        source.resume()
        after(limits.hello, k) { [weak self] in if k.state == .hello { self?.shut(k) } }
    }
    private func readable(_ k: Conn) {
        let n = chunk.withUnsafeMutableBytes { Darwin.read(k.fd, $0.baseAddress, $0.count) }
        if n < 0, errno == EAGAIN || errno == EINTR { return }
        guard n > 0 else { return k.state == .open ? drop(k, n == 0 ? "eof" : "error") : shut(k) }
        switch k.state {
        case .hello: heard(k, chunk[0..<n])
        case .open: lines(k, chunk[0..<n])
        case .ending, .dead: break
        }
    }

    /// The agent's first line: the proof of the token, alone; then the answer. A probe is answered and goes no further.
    private func heard(_ k: Conn, _ data: ArraySlice<UInt8>) {
        guard let i = data.firstIndex(of: 10) else {
            k.hello += data
            if k.hello.count > Self.helloMax { shut(k) }
            return
        }
        let line = k.hello + data[..<i], x = k.inst
        k.hello = []
        guard line.count <= Self.helloMax, i == data.endIndex - 1,
              let m = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any], GlazeAgentFrames.whole(m["glaze-mcp"]) == 1,
              let n = m["n"] as? String, Self.nonce(n), let p = m["p"] as? String, Self.same(p, Self.mac(x.key, "a", n)) else { return shut(k) }
        x.joining[ObjectIdentifier(k)] = nil
        put(k, Array("{\"ok\":1,\"p\":\"\(Self.mac(x.key, "h", n))\"}\n".utf8))
        if GlazeAgentFrames.whole(m["probe"]) == 1 {
            k.state = .ending
            if k.queued == 0 { shutdown(k.fd, SHUT_WR) }
            return after(limits.drain, k) { [weak self] in self?.shut(k) }
        }
        k.state = .open
        k.peer = Self.peer(k.pid) ?? Self.reported(m["peer"])
        k.c = next
        next += 1
        x.conns[k.c] = k
        if x.session != nil { send(x, ["t": "open", "c": k.c, "peer": k.peer]) } else { pause(k) }
    }
    /// Lines from the agent, cut at "\n" (lines.js), each to the worker as frames; over limits.line closes it as too-long.
    private func lines(_ k: Conn, _ data: ArraySlice<UInt8>) {
        let x = k.inst
        var rest = data
        while let i = rest.firstIndex(of: 10) {
            guard k.parts.count + (i - rest.startIndex) <= limits.line else { return drop(k, "too-long") }
            let text = String(decoding: k.parts + rest[..<i], as: UTF8.self)
            k.parts = []
            rest = rest[(i + 1)...]
            for f in GlazeAgentFrames.split(k.c, Array(text.utf16)) { send(x, f) }
        }
        k.parts += rest
        if k.parts.count > limits.line { return drop(k, "too-long") }
        if x.waiting > limits.high { for k in x.conns.values { pause(k) } }
    }
    /// A line frame from the worker, written as it comes, its last piece with "\n" (mux.js frame).
    private func toAgent(_ x: Instance, _ f: [String: Any]) {
        guard let c = f["c"] as? Int, let k = x.conns[c], let d = f["d"] as? String else { return }
        let bytes = Array(d.utf8), more = f["m"] != nil
        if bytes.contains(10) { return drop(k, "bad-line") }
        k.toAgent += bytes.count
        if k.toAgent > limits.line { return drop(k, "too-long") }
        if !more { k.toAgent = 0 }
        if !bytes.isEmpty || !more { put(k, more ? bytes : bytes + [10]) }
        if k.queued > limits.queue { drop(k, "overflow") }
    }
    /// The worker closed c: what was written still goes, then the agent hears the end; one that never reads is cut off.
    private func closed(_ x: Instance, _ c: Int) {
        guard let k = x.conns.removeValue(forKey: c) else { return }
        k.state = .ending
        resume(k)
        if k.queued == 0 { shutdown(k.fd, SHUT_WR) }
        after(limits.drain, k) { [weak self] in self?.shut(k) }
    }
    /// The app closes c, and tells the worker why: eof, error, too-long, overflow or bad-line (mux.js).
    private func drop(_ k: Conn, _ why: String) {
        let x = k.inst
        if x.conns[k.c] === k {
            x.conns[k.c] = nil
            send(x, ["t": "close", "c": k.c, "why": why])
        }
        shut(k)
    }
    private func shut(_ k: Conn) {
        guard k.state != .dead else { return }
        k.state = .dead
        k.inst.joining[ObjectIdentifier(k)] = nil
        k.deadline += 1
        if k.paused { k.read?.resume(); k.paused = false }
        k.read?.cancel()
        k.write?.cancel()
        k.write = nil
    }
    private func pause(_ k: Conn) {
        guard k.state == .open, !k.paused, let r = k.read else { return }
        r.suspend()
        k.paused = true
    }
    private func resume(_ k: Conn) {
        guard k.paused, k.state != .open || k.inst.session != nil, let r = k.read else { return }
        r.resume()
        k.paused = false
    }
    /// f after seconds, unless another deadline for k replaces it or k is shut first.
    private func after(_ seconds: TimeInterval, _ k: Conn, _ f: @escaping @MainActor () -> Void) {
        k.deadline += 1
        let g = k.deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { if k.deadline == g { f() } }
    }

    private func put(_ k: Conn, _ bytes: [UInt8]) {
        guard k.state != .dead else { return }
        k.buffer += bytes
        flushWrites(k)
    }
    private func flushWrites(_ k: Conn) {
        while k.queued > 0 {
            let n = k.buffer[k.at...].withUnsafeBytes { Darwin.write(k.fd, $0.baseAddress, $0.count) }
            if n < 0, errno == EINTR { continue }
            if n < 0, errno == EAGAIN { break }
            guard n > 0 else { return k.state == .open ? drop(k, "error") : shut(k) }
            k.at += n
        }
        if k.queued == 0 {
            k.buffer = []
            k.at = 0
            k.write?.cancel()
            k.write = nil
            if k.state == .ending { shutdown(k.fd, SHUT_WR) }
        } else if k.write == nil {
            if k.at > 1 << 20 { k.buffer.removeFirst(k.at); k.at = 0 }
            let source = DispatchSource.makeWriteSource(fileDescriptor: k.fd, queue: .main)
            k.sources += 1
            source.setEventHandler { [weak self] in self?.flushWrites(k) }
            source.setCancelHandler { k.sources -= 1; if k.sources == 0 { Darwin.close(k.fd) } }
            k.write = source
            source.resume()
        }
    }

    // MARK: Handshake and peers (handshake.js)

    static func mac(_ key: [UInt8], _ tag: String, _ n: String) -> String {
        Data(HMAC<SHA256>.authenticationCode(for: Data((tag + n).utf8), using: SymmetricKey(data: key))).base64EncodedString()
    }
    static func same(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        return x.count == y.count && zip(x, y).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }
    static func nonce(_ n: String) -> Bool {
        (16...128).contains(n.utf8.count) && n.utf8.allSatisfy { c in
            (0x41...0x5A).contains(c) || (0x61...0x7A).contains(c) || (0x30...0x39).contains(c) || c == 0x2B || c == 0x2F || c == 0x3D
        }
    }
    /// The agent's parent as the kernel has it: its program and pid, verified; nil once either is gone.
    static func peer(_ pid: pid_t) -> [String: Any]? {
        var info = proc_bsdinfo(), path = [CChar](repeating: 0, count: 4096)
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.pbi_ppid > 0,
              proc_pidpath(Int32(info.pbi_ppid), &path, UInt32(path.count)) > 0 else { return nil }
        let exe = String(cString: path)
        guard exe.utf16.count <= GlazeAgentFrames.string else { return nil }
        return ["exe": exe, "ppid": Int(info.pbi_ppid), "verified": true]
    }
    /// What the agent said of itself, which no one can check (handshake.js peerOf).
    static func reported(_ p: Any?) -> [String: Any] {
        var out: [String: Any] = ["verified": false]
        guard let p = p as? [String: Any] else { return out }
        for k in ["name", "exe"] { if let s = p[k] as? String, s.utf16.count <= GlazeAgentFrames.string { out[k] = s } }
        if let n = GlazeAgentFrames.whole(p["ppid"]), n >= 0 { out["ppid"] = n }
        return out
    }

    // MARK: The run folder (rendezvous.js)

    /// The folder 0700, this user's and not a symlink, held by a descriptor; names relative to it; changes under its
    /// .rendezvous.lock, which the Node hosts and agents take too.
    private enum Run {
        struct Refused: Error { let why: String; init(_ why: String) { self.why = why } }
        static func folder(_ st: stat, _ path: String) throws {
            guard st.st_mode & S_IFMT != S_IFLNK else { throw Refused("\(path) is a symlink") }
            guard st.st_mode & S_IFMT == S_IFDIR else { throw Refused("\(path) is not a folder") }
            guard st.st_uid == getuid() else { throw Refused("\(path) belongs to another user") }
            let mode = st.st_mode & 0o777
            guard mode == 0o700 else { throw Refused("\(path) has mode \(String(mode, radix: 8)), not 700; chmod 700 it") }
        }
        /// The folder, made if missing; a descriptor for it that the caller closes.
        static func open(_ path: String) throws -> Int32 {
            try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            if mkdir(path, 0o700) != 0, errno != EEXIST { throw Refused("\(path) could not be made") }
            var st = stat(), got = stat()
            guard lstat(path, &st) == 0 else { throw Refused("\(path) is missing") }
            try folder(st, path)
            let fd = Darwin.open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            guard fd >= 0 else { throw Refused("\(path) could not be opened") }
            guard fstat(fd, &got) == 0, got.st_dev == st.st_dev, got.st_ino == st.st_ino else {
                Darwin.close(fd)
                throw Refused("\(path) changed while opening it")
            }
            return fd
        }
        /// f with the working folder the pinned one, checked to be it, then back. Only on the main thread, briefly.
        static func inside(_ dir: Int32, _ f: () throws -> Void) throws {
            let was = Darwin.open(".", O_RDONLY | O_DIRECTORY)
            defer { if was >= 0 { _ = fchdir(was); Darwin.close(was) } }
            var a = stat(), b = stat()
            guard was >= 0, fstat(dir, &a) == 0, fchdir(dir) == 0, stat(".", &b) == 0, a.st_dev == b.st_dev, a.st_ino == b.st_ino else {
                throw Refused("the run folder changed while entering it")
            }
            try f()
        }
        static func locked(_ dir: Int32, _ f: () throws -> Void) throws {
            var fd: Int32 = -1
            for _ in 0..<20 {
                fd = openat(dir, ".rendezvous.lock", O_WRONLY | O_CREAT | O_EXCL, 0o600)
                if fd >= 0 || errno != EEXIST { break }
                usleep(10_000)
            }
            guard fd >= 0 else { throw Refused("run folder is busy (.rendezvous.lock)") }
            let pid = Array(String(getpid()).utf8)
            _ = Darwin.write(fd, pid, pid.count)
            defer { Darwin.close(fd); unlinkat(dir, ".rendezvous.lock", 0) }
            try f()
        }
        /// A run file's JSON: a regular file of this user's, 0600 when private, at most 64 KiB (rendezvous.js json).
        static func json(_ dir: Int32, _ name: String, private only: Bool = true) -> [String: Any]? {
            var st = stat(), got = stat()
            guard fstatat(dir, name, &st, AT_SYMLINK_NOFOLLOW) == 0, st.st_mode & S_IFMT == S_IFREG else { return nil }
            let fd = openat(dir, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
            guard fd >= 0 else { return nil }
            defer { Darwin.close(fd) }
            guard fstat(fd, &got) == 0, got.st_mode & S_IFMT == S_IFREG, got.st_dev == st.st_dev, got.st_ino == st.st_ino,
                  got.st_size <= 64 * 1024, got.st_uid == getuid(), !only || got.st_mode & 0o777 == 0o600 else { return nil }
            var bytes = [UInt8](repeating: 0, count: Int(got.st_size))
            guard bytes.isEmpty || Darwin.read(fd, &bytes, bytes.count) == bytes.count else { return nil }
            return (try? JSONSerialization.jsonObject(with: Data(bytes))) as? [String: Any]
        }
        /// r when it is a valid run file for base in run (rendezvous.js record).
        static func record(_ r: [String: Any]?, run: String, base: String) -> [String: Any]? {
            guard let r, GlazeAgentFrames.whole(r["v"]) == 1, "safari.\(r["instance"] as? String ?? "")" == base, r["browser"] as? String == "safari",
                  let pid = GlazeAgentFrames.whole(r["pid"]), pid > 0, let t = r["token"] as? String, token(t),
                  let at = r["at"] as? NSNumber, GlazeAgentFrames.bool(at) == nil, at.doubleValue.isFinite,
                  r["path"] as? String == "\(run)/\(base).sock" else { return nil }
            return r
        }
        static func token(_ t: String) -> Bool {
            let u = Array(t.utf8)
            return u.count == 44 && u[43] == 0x3D && u[..<43].allSatisfy { c in
                (0x41...0x5A).contains(c) || (0x61...0x7A).contains(c) || (0x30...0x39).contains(c) || c == 0x2B || c == 0x2F
            }
        }
        static func alive(_ pid: Int) -> Bool { Darwin.kill(pid_t(pid), 0) == 0 || errno == EPERM }
        /// name written whole or not at all: a private temporary file renamed over it.
        static func put(_ dir: Int32, _ name: String, _ data: Data) throws {
            var r = [UInt8](repeating: 0, count: 8)
            _ = SecRandomCopyBytes(kSecRandomDefault, r.count, &r)
            let tmp = "\(name).\(getpid()).\(r.map { String(format: "%02x", $0) }.joined()).tmp"
            let fd = openat(dir, tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { throw Refused("the run file could not be written") }
            let bytes = [UInt8](data)
            let ok = fchmod(fd, 0o600) == 0 && Darwin.write(fd, bytes, bytes.count) == bytes.count
            Darwin.close(fd)
            guard ok, renameat(dir, tmp, dir, name) == 0 else {
                unlinkat(dir, tmp, 0)
                throw Refused("the run file could not be written")
            }
        }
    }
}
#endif
