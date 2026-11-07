import Foundation

/// Soniox リアルタイム(WebSocket)。1〜2秒で逐次表示。切断時は自動再接続。
final class SonioxEngine: TranscriptionEngine {
    private let apiKey: String, model: String, lang: String, diarize: Bool
    private let urlString = "wss://stt-rt.soniox.com/transcribe-websocket"
    private let cb: EngineCallbacks
    private let now: () -> Double

    private let lock = NSLock()
    private var task: URLSessionWebSocketTask?
    private var streamOffset = 0.0
    private var finalBuf = ""
    private var segStartMs: Double?
    private var lastSpeaker: String?
    private var stopping = false
    private var finished = false
    private var billedSec = 0.0

    init(apiKey: String, model: String, lang: String, diarize: Bool, now: @escaping () -> Double, callbacks: EngineCallbacks) {
        self.apiKey = apiKey; self.model = model; self.lang = lang; self.diarize = diarize; self.now = now; self.cb = callbacks
    }

    var displayName: String { "Soniox \(model)" }
    var costPerMinute: Double { 0.12 / 60 }

    func start() async throws {
        if apiKey.isEmpty { throw AppError("Soniox APIキーを設定してください") }
        try await connect()
    }

    private func connect() async throws {
        guard let url = URL(string: urlString) else { throw AppError("URL不正") }
        let t = URLSession.shared.webSocketTask(with: url)
        lock.withLock { task = t; finished = false; streamOffset = now() }
        t.resume()
        let cfg: [String: Any] = [
            "api_key": apiKey, "model": model,
            "audio_format": "pcm_s16le", "sample_rate": Int(sampleRate), "num_channels": 1,
            "language_hints": [lang], "enable_endpoint_detection": true, "enable_speaker_diarization": diarize,
        ]
        let json = String(data: try JSONSerialization.data(withJSONObject: cfg), encoding: .utf8)!
        try await t.send(.string(json))
        receive(t)
    }

    func feed(_ pcm: [Int16]) {
        let t = lock.withLock { () -> URLSessionWebSocketTask? in
            billedSec += Double(pcm.count) / sampleRate
            return task
        }
        let data = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
        t?.send(.data(data)) { _ in }
    }

    func stop() async -> Double {
        let t = lock.withLock { () -> URLSessionWebSocketTask? in stopping = true; return task }
        try? await t?.send(.string(""))   // 終了通知(残りを確定させる)
        let t0 = Date()
        while !lock.withLock({ finished }) && Date().timeIntervalSince(t0) < 5 {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        t?.cancel(with: .normalClosure, reason: nil)
        pushSegment()
        return lock.withLock { billedSec }
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let msg):
                if case .string(let s) = msg { self.handle(s) }
                else if case .data(let d) = msg, let s = String(data: d, encoding: .utf8) { self.handle(s) }
                if !self.lock.withLock({ self.finished }) { self.receive(t) }
            case .failure(let e):
                self.lock.withLock { self.finished = true }
                self.pushSegment()
                if !self.lock.withLock({ self.stopping }) {
                    self.cb.onStatus("Soniox 切断(\(e.localizedDescription))。再接続します…")
                    Task {
                        try? await Task.sleep(nanoseconds: 1_000_000_000)
                        do { try await self.connect(); self.cb.onStatus("Soniox 再接続しました") }
                        catch { self.cb.onStatus("Soniox 再接続失敗: \(error.localizedDescription)") }
                    }
                }
            }
        }
    }

    private func handle(_ s: String) {
        guard let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let code = obj["error_code"] {
            cb.onStatus("Sonioxエラー \(code): \(obj["error_message"] ?? "")")
            return
        }
        var interim = ""
        var emits: [Segment] = []
        lock.withLock {
            for tok in (obj["tokens"] as? [[String: Any]]) ?? [] {
                let text = tok["text"] as? String ?? ""
                let isFinal = tok["is_final"] as? Bool ?? false
                if text == "<end>" || text == "<fin>" {
                    if isFinal, let seg = takeSegmentLocked() { emits.append(seg) }
                    continue
                }
                guard isFinal else { interim += text; continue }
                let speaker: String? = tok["speaker"].flatMap { $0 is NSNull ? nil : "\($0)" }
                if diarize, let sp = speaker, let last = lastSpeaker, sp != last, !finalBuf.isEmpty, let seg = takeSegmentLocked() { emits.append(seg) }
                if segStartMs == nil { segStartMs = (tok["start_ms"] as? NSNumber)?.doubleValue ?? 0 }
                if let sp = speaker { lastSpeaker = sp }
                finalBuf += text
                let endsSentence = text.hasSuffix("。") || text.hasSuffix("？") || text.hasSuffix("！") || text.hasSuffix("?")
                if (endsSentence && finalBuf.count > 40) || finalBuf.count > 140, let seg = takeSegmentLocked() { emits.append(seg) }
            }
            if obj["finished"] as? Bool == true {
                finished = true
                if let seg = takeSegmentLocked() { emits.append(seg) }
            }
            interim = finalBuf + interim
        }
        emits.forEach(cb.onSegment)
        cb.onInterim(interim)
    }

    /// lock 取得中に呼ぶこと
    private func takeSegmentLocked() -> Segment? {
        let text = finalBuf.trimmingCharacters(in: .whitespacesAndNewlines)
        defer { finalBuf = ""; segStartMs = nil }
        guard !text.isEmpty else { return nil }
        return Segment(t: streamOffset + (segStartMs ?? 0) / 1000, text: text, speaker: diarize ? lastSpeaker : nil)
    }

    private func pushSegment() {
        if let seg = lock.withLock({ takeSegmentLocked() }) { cb.onSegment(seg) }
    }
}
