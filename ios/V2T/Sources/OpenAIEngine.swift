import Foundation

/// OpenAI 音声認識(8〜20秒ごとに区切って送信。区間の順序を保って表示し、失敗時は最大3回再送)
final class OpenAIEngine: TranscriptionEngine {
    private let apiKey: String, model: String, lang: String
    private let offset: Double
    private let cb: EngineCallbacks
    private let queue = DispatchQueue(label: "v2t.openai.chunker")
    private var chunker: Chunker!

    private let lock = NSLock()
    private var seqCounter = 0, nextEmit = 0, pending = 0
    private var done: [Int: Segment?] = [:]
    private var context = ""
    private var billedSec = 0.0

    init(apiKey: String, model: String, lang: String, minSec: Double, maxSec: Double, offset: Double, callbacks: EngineCallbacks) {
        self.apiKey = apiKey; self.model = model; self.lang = lang; self.offset = offset; self.cb = callbacks
        chunker = Chunker(minSec: minSec, maxSec: maxSec) { [weak self] pcm, st in self?.send(pcm, st) }
    }

    var displayName: String { "OpenAI \(model)" }
    var costPerMinute: Double { model == "gpt-4o-mini-transcribe" ? 0.003 : 0.006 }

    func start() async throws {
        if apiKey.isEmpty { throw AppError("OpenAI APIキーを設定してください") }
    }

    func feed(_ pcm: [Int16]) { queue.async { self.chunker.push(pcm) } }

    func stop() async -> Double {
        queue.sync { chunker.flush() }
        let t0 = Date()
        while lock.withLock({ pending }) > 0 && Date().timeIntervalSince(t0) < 30 {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return lock.withLock { billedSec }
    }

    private func send(_ pcm: [Int16], _ startSec: Double) {
        let (seq, prompt, p) = lock.withLock { () -> (Int, String, Int) in
            let s = seqCounter; seqCounter += 1; pending += 1
            billedSec += Double(pcm.count) / sampleRate
            return (s, context, pending)
        }
        cb.onInterim("…文字起こし中(\(p)件)")
        let wav = encodeWav(pcm)
        let t = offset + startSec
        Task {
            var seg: Segment? = nil
            for attempt in 0..<3 {
                do {
                    let text = cleanup(try await Self.transcribe(wav: wav, apiKey: apiKey, model: model, lang: lang, prompt: prompt))
                    seg = text.isEmpty ? nil : Segment(t: t, text: text)
                    break
                } catch {
                    if attempt == 2 {
                        cb.onStatus("送信失敗: \(error.localizedDescription)")
                        seg = Segment(t: t, text: "[⚠ この区間は文字起こし失敗]")
                    } else {
                        try? await Task.sleep(nanoseconds: UInt64(1_500_000_000 * (attempt + 1)))
                    }
                }
            }
            complete(seq, seg)
        }
    }

    private func complete(_ seq: Int, _ seg: Segment?) {
        let (emits, p) = lock.withLock { () -> ([Segment], Int) in
            done[seq] = seg
            pending -= 1
            var out: [Segment] = []
            while let s = done.removeValue(forKey: nextEmit) {
                nextEmit += 1
                if let s { out.append(s); context = String((context + s.text).suffix(200)) }
            }
            return (out, pending)
        }
        emits.forEach(cb.onSegment)
        cb.onInterim(p > 0 ? "…文字起こし中(\(p)件)" : "")
    }

    static func transcribe(wav: Data, apiKey: String, model: String, lang: String, prompt: String) async throws -> String {
        var req = URLRequest(url: URL(string: "https://api.openai.com/v1/audio/transcriptions")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        let boundary = "v2t-\(UUID().uuidString)"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("model", model)
        field("language", lang)
        field("response_format", "json")
        if !prompt.isEmpty { field("prompt", prompt) }
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(wav)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            throw AppError("OpenAI \(code): \(String(String(data: data, encoding: .utf8)?.prefix(200) ?? ""))")
        }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Whisper 系が無音で出しがちな定型の誤出力を除去
func cleanup(_ text: String) -> String {
    var t = text
    for p in ["ご視聴ありがとうございました。?", "チャンネル登録(よろしくお願いします|お願いします)。?"] {
        t = t.replacingOccurrences(of: p, with: "", options: .regularExpression)
    }
    t = t.trimmingCharacters(in: .whitespacesAndNewlines)
    if ["はい", "はい。", "ん", "ん。"].contains(t) { return "" }
    return t
}
