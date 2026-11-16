import Foundation

/// 用語リスト(改行・読点・カンマ区切り)を整形
func parseGlossary(_ text: String) -> [String] {
    var seen = Set<String>(), out: [String] = []
    for raw in text.components(separatedBy: CharacterSet(charactersIn: "\n,、，")) {
        let t = String(raw.replacingOccurrences(of: "[<>\r\n]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces).prefix(60))
        if !t.isEmpty && !seen.contains(t) { seen.insert(t); out.append(t) }
    }
    return Array(out.prefix(100))
}

/// OpenAI 音声認識(発話の切れ目で 8〜20 秒ごとに区切って送信)。
/// 直前の書き起こしを次の区間のプロンプトに使うため、区間は 1 本ずつ順番に送る。失敗時は最大3回再送。
final class OpenAIEngine: TranscriptionEngine {
    private let apiKey: String, model: String, lang: String, keywords: [String], normalize: Bool
    private let offset: Double
    private let cb: EngineCallbacks
    private let queue = DispatchQueue(label: "v2t.openai.chunker")
    private var chunker: Chunker!

    private let lock = NSLock()
    private var pending = 0
    private var context = ""
    private var billedSec = 0.0
    private var chain: Task<Void, Never>?

    /// gpt-transcribe の languages[] / keywords[] が拒否されたら旧形式に切り替える
    private static let legacyLock = NSLock()
    private static var legacyFields = false

    init(apiKey: String, model: String, lang: String, glossary: String, normalize: Bool,
         minSec: Double, maxSec: Double, offset: Double, callbacks: EngineCallbacks) {
        self.apiKey = apiKey; self.model = model; self.lang = lang; self.offset = offset; self.cb = callbacks
        self.keywords = parseGlossary(glossary); self.normalize = normalize
        chunker = Chunker(minSec: minSec, maxSec: maxSec) { [weak self] pcm, st, ratio in self?.enqueue(pcm, st, ratio) }
    }

    var displayName: String { "OpenAI \(model)" }
    var costPerMinute: Double {
        switch model {
        case "gpt-transcribe": return 0.0045
        case "gpt-4o-mini-transcribe": return 0.003
        default: return 0.006
        }
    }

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

    /// chunker のキュー上で呼ばれる
    private func enqueue(_ pcm: [Int16], _ startSec: Double, _ speechRatio: Double) {
        let p = lock.withLock { () -> Int in
            pending += 1
            billedSec += Double(pcm.count) / sampleRate
            return pending
        }
        cb.onInterim("…文字起こし中(\(p)件)")
        let prev = chain
        chain = Task { [weak self] in
            await prev?.value
            await self?.process(pcm, startSec, speechRatio)
        }
    }

    private func process(_ pcm: [Int16], _ startSec: Double, _ speechRatio: Double) async {
        let wav = encodeWav(normalize ? normalizeGain(pcm) : pcm)
        let prompt = lock.withLock { context }
        var text: String? = nil
        for attempt in 0..<3 {
            do {
                text = cleanup(try await transcribe(wav: wav, prompt: prompt), speechRatio: speechRatio)
                break
            } catch {
                if attempt == 2 {
                    cb.onStatus("送信失敗: \(error.localizedDescription)")
                    text = "[⚠ この区間は文字起こし失敗]"
                } else {
                    try? await Task.sleep(nanoseconds: UInt64(1_500_000_000 * (attempt + 1)))
                }
            }
        }
        let p = lock.withLock { () -> Int in
            pending -= 1
            if let t = text, !t.isEmpty, !t.hasPrefix("[⚠") { context = String((context + t).suffix(200)) }
            return pending
        }
        if let t = text, !t.isEmpty { cb.onSegment(Segment(t: offset + startSec, text: t)) }
        cb.onInterim(p > 0 ? "…文字起こし中(\(p)件)" : "")
    }

    private func transcribe(wav: Data, prompt: String) async throws -> String {
        let useNew = model.hasPrefix("gpt-transcribe") && !Self.legacyLock.withLock({ Self.legacyFields })
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
        field("response_format", "json")
        if useNew {
            field("languages[]", lang)
            keywords.forEach { field("keywords[]", $0) }
            if !prompt.isEmpty { field("prompt", prompt) }
        } else {
            field("language", lang)
            let p = (keywords.isEmpty ? "" : keywords.joined(separator: "、") + "。") + prompt
            if !p.isEmpty { field("prompt", String(p.suffix(800))) }
        }
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(wav)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let msg = String(String(data: data, encoding: .utf8)?.prefix(300) ?? "")
        if code == 400 && useNew && msg.range(of: "language|keyword", options: [.regularExpression, .caseInsensitive]) != nil {
            Self.legacyLock.withLock { Self.legacyFields = true }
            return try await transcribe(wav: wav, prompt: prompt)
        }
        guard code == 200 else { throw AppError("OpenAI \(code): \(msg)") }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Whisper 系が無音・雑音から出しがちな定型の誤出力(Bag of Hallucinations)とループを除去
func cleanup(_ text: String, speechRatio: Double = 1) -> String {
    var t = text
    let bag = [
        "ご視聴(いただき)?ありがとうございました。?", "最後までご(視聴|覧)いただき(ありがとうございました|ありがとうございます)。?",
        "チャンネル登録(よろしくお願いします|お願いします|をお願いします)。?", "高評価(よろしくお願いします|お願いします)。?",
        "次回(も)?お楽しみに。?",
    ]
    for p in bag { t = t.replacingOccurrences(of: p, with: "", options: .regularExpression) }
    t = t.replacingOccurrences(of: "(.{1,20}?)\\1{3,}", with: "$1", options: .regularExpression)
    t = t.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.range(of: "^[\\s。、.,!?！？・…]*$", options: .regularExpression) != nil { return "" }
    if speechRatio < 0.1 && t.count <= 12 { return "" }
    if speechRatio < 0.3 && t.range(of: "^(はい|ん|うん|えー|あー)[。、]?$", options: .regularExpression) != nil { return "" }
    return t
}
