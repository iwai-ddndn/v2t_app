import AVFoundation
import SwiftUI

enum Keychain {
    static func get(_ key: String) -> String {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return "" }
        return String(data: d, encoding: .utf8) ?? ""
    }
    static func set(_ value: String, _ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
        guard !value.isEmpty else { return }
        var a = q
        a[kSecValueData as String] = Data(value.utf8)
        a[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(a as CFDictionary, nil)
    }
}

/// 設定(APIキーは Keychain、それ以外は UserDefaults)
final class SettingsStore: ObservableObject {
    private let d = UserDefaults.standard
    @Published var engine: EngineKind { didSet { d.set(engine.rawValue, forKey: "engine") } }
    @Published var openaiKey: String { didSet { Keychain.set(openaiKey, "openaiKey") } }
    @Published var sonioxKey: String { didSet { Keychain.set(sonioxKey, "sonioxKey") } }
    @Published var openaiModel: String { didSet { d.set(openaiModel, forKey: "openaiModel") } }
    @Published var glossary: String { didSet { d.set(glossary, forKey: "glossary") } }
    @Published var normalize: Bool { didSet { d.set(normalize, forKey: "normalize") } }
    @Published var summaryModel: String { didSet { d.set(summaryModel, forKey: "summaryModel") } }
    @Published var sonioxModel: String { didSet { d.set(sonioxModel, forKey: "sonioxModel") } }
    @Published var diarize: Bool { didSet { d.set(diarize, forKey: "diarize") } }
    @Published var chunkMin: Double { didSet { d.set(chunkMin, forKey: "chunkMin") } }
    @Published var chunkMax: Double { didSet { d.set(chunkMax, forKey: "chunkMax") } }
    @Published var fontSize: Double { didSet { d.set(fontSize, forKey: "fontSize") } }
    @Published var ringMinutes: Int { didSet { d.set(ringMinutes, forKey: "ringMinutes") } }
    @Published var yenPerUsd: Double { didSet { d.set(yenPerUsd, forKey: "yenPerUsd") } }

    init() {
        engine = EngineKind(rawValue: d.string(forKey: "engine") ?? "") ?? .openai
        openaiKey = Keychain.get("openaiKey")
        sonioxKey = Keychain.get("sonioxKey")
        // 旧既定(mini)は最新の gpt-transcribe に移行
        let storedModel = d.string(forKey: "openaiModel")
        let oldVersion = d.integer(forKey: "settingsVersion") < 2
        if let m = storedModel, !(oldVersion && m == "gpt-4o-mini-transcribe") { openaiModel = m } else { openaiModel = "gpt-transcribe" }
        glossary = d.string(forKey: "glossary") ?? ""
        normalize = d.object(forKey: "normalize") as? Bool ?? true
        summaryModel = d.string(forKey: "summaryModel") ?? "gpt-5-mini"
        sonioxModel = d.string(forKey: "sonioxModel") ?? "stt-rt-v5"
        diarize = d.bool(forKey: "diarize")
        chunkMin = d.object(forKey: "chunkMin") as? Double ?? 8
        chunkMax = d.object(forKey: "chunkMax") as? Double ?? 20
        fontSize = d.object(forKey: "fontSize") as? Double ?? 18
        ringMinutes = d.object(forKey: "ringMinutes") as? Int ?? 10
        yenPerUsd = d.object(forKey: "yenPerUsd") as? Double ?? 150
        d.set(openaiModel, forKey: "openaiModel")   // init 中は didSet が呼ばれないので明示的に保存
        d.set(2, forKey: "settingsVersion")
    }
}

struct SavedSession: Codable {
    var created = Date()
    var segments: [Segment] = []
    var baseElapsed: Double = 0
    var usd: Double = 0
}

@MainActor
final class Recorder: ObservableObject {
    @Published private(set) var segments: [Segment] = []
    @Published var interim = ""
    @Published var status = "停止中"
    @Published private(set) var running = false
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var costUSD: Double = 0
    @Published var highlightFrom: Double?

    let settings: SettingsStore
    private var session = SavedSession()
    private var engine: TranscriptionEngine?
    private let capture = AudioCapture()
    private(set) var ring: RingBuffer?
    private var startedAt: Date?
    private var timer: Timer?
    private var player: AVAudioPlayer?

    init(settings: SettingsStore) {
        self.settings = settings
        load()
    }

    // MARK: 保存(端末内のみ。ロック中も書き込めるよう初回ロック解除後に読み書き可能な保護クラス)
    private var docs: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private var currentURL: URL { docs.appendingPathComponent("current.json") }
    private var historyDir: URL { docs.appendingPathComponent("history", isDirectory: true) }

    private func load() {
        guard let d = try? Data(contentsOf: currentURL), let s = try? JSONDecoder().decode(SavedSession.self, from: d) else { return }
        session = s; segments = s.segments; elapsed = s.baseElapsed; costUSD = s.usd
    }
    private func save() {
        session.segments = segments
        guard let d = try? JSONEncoder().encode(session) else { return }
        try? d.write(to: currentURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    var history: [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: historyDir, includingPropertiesForKeys: nil)) ?? [])
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    func archiveAndReset() {
        guard !running else { return }
        if !segments.isEmpty {
            try? FileManager.default.createDirectory(at: historyDir, withIntermediateDirectories: true)
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HHmm"
            let url = historyDir.appendingPathComponent("会議メモ_\(f.string(from: session.created)).txt")
            try? plainText(segments).data(using: .utf8)?.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        session = SavedSession(); segments = []; elapsed = 0; costUSD = 0; ring = nil; highlightFrom = nil
        save()
    }

    // MARK: 録音
    func start() async {
        guard !running else { return }
        guard await AVAudioApplication.requestRecordPermission() else {
            status = "マイクが許可されていません(設定アプリ → 会議メモ → マイク)"; return
        }
        let base = session.baseElapsed
        let startDate = Date()
        let now = Self.makeNow(base: base, start: startDate)
        let cb = Self.makeCallbacks(self)
        let lang = "ja"
        let eng: TranscriptionEngine
        switch settings.engine {
        case .openai:
            eng = OpenAIEngine(apiKey: settings.openaiKey, model: settings.openaiModel, lang: lang,
                               glossary: settings.glossary, normalize: settings.normalize,
                               minSec: settings.chunkMin, maxSec: settings.chunkMax, offset: base, callbacks: cb)
        case .soniox:
            eng = SonioxEngine(apiKey: settings.sonioxKey, model: settings.sonioxModel, lang: lang,
                               diarize: settings.diarize, glossary: settings.glossary, normalize: settings.normalize,
                               now: now, callbacks: cb)
        }
        do {
            try await eng.start()
            if ring == nil { ring = RingBuffer(seconds: settings.ringMinutes * 60) }
            let ring = self.ring!
            capture.onFrame = Self.makeFrameHandler(ring: ring, engine: eng)
            capture.onStatus = cb.onStatus
            try capture.start()
        } catch {
            status = "開始できません: \(error.localizedDescription)"
            _ = await eng.stop()
            return
        }
        engine = eng; startedAt = startDate; running = true
        status = "録音中(\(eng.displayName))— 画面を消しても続きます"
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    // MARK: 別スレッドから呼ばれるクロージャ(MainActor に紐づけないよう nonisolated で生成)
    nonisolated private static func makeNow(base: Double, start: Date) -> () -> Double {
        { base + Date().timeIntervalSince(start) }
    }
    nonisolated private static func makeFrameHandler(ring: RingBuffer, engine: TranscriptionEngine) -> ([Int16]) -> Void {
        { pcm in ring.push(pcm); engine.feed(pcm) }
    }
    nonisolated private static func makeCallbacks(_ r: Recorder) -> EngineCallbacks {
        // Recorder は @MainActor クラス(=Sendable)なので、そのまま捕捉してメインスレッドで更新する
        return EngineCallbacks(
            onSegment: { s in DispatchQueue.main.async { [weak r] in MainActor.assumeIsolated { r?.add(s) } } },
            onInterim: { t in DispatchQueue.main.async { [weak r] in MainActor.assumeIsolated { r?.interim = t } } },
            onStatus: { t in DispatchQueue.main.async { [weak r] in MainActor.assumeIsolated { r?.status = t } } }
        )
    }

    func stop() async {
        guard running, let eng = engine, let st = startedAt else { return }
        status = "停止処理中…(残りの文字起こしを待っています)"
        capture.stop()
        timer?.invalidate(); timer = nil
        session.baseElapsed += Date().timeIntervalSince(st)
        running = false; startedAt = nil
        let sec = await eng.stop()
        session.usd += sec / 60 * eng.costPerMinute
        engine = nil; interim = ""
        elapsed = session.baseElapsed; costUSD = session.usd
        status = "停止中(「再開」で続きから記録)"
        save()
    }

    private func tick() {
        guard let st = startedAt else { return }
        let live = Date().timeIntervalSince(st)
        elapsed = session.baseElapsed + live
        costUSD = session.usd + live / 60 * (engine?.costPerMinute ?? 0)
    }

    private func add(_ s: Segment) {
        var i = segments.count
        while i > 0 && segments[i - 1].t > s.t { i -= 1 }   // 時刻順に挿入
        segments.insert(s, at: i)
        save()
    }

    // MARK: 巻き戻し・聞き直し・要約
    /// 指定秒数前以降の最初の区間を返し、その範囲をハイライトする
    func rewind(_ sec: Double) -> Segment.ID? {
        let from = elapsed - sec
        highlightFrom = from
        if let i = segments.firstIndex(where: { $0.t >= from - 0.01 }) {
            return segments[max(0, i - 1)].id   // 区切りの途中から始まっている可能性があるので1つ前から
        }
        return segments.last?.id
    }

    func play(last sec: Double) {
        guard let ring, ring.filled > 0 else { status = "まだ音声がありません(録音中のみ聞き直せます)"; return }
        player?.stop()
        player = try? AVAudioPlayer(data: encodeWav(normalizeGain(ring.last(seconds: sec))))
        player?.play()
    }
    func stopPlaying() { player?.stop() }

    func summarize(range sec: Double) async -> String {
        let from = sec > 0 ? elapsed - sec : -1
        let text = plainText(segments.filter { $0.t >= from }, withTime: false)
        if text.isEmpty { return "対象範囲に文字起こしがありません" }
        if settings.openaiKey.isEmpty { return "要約には OpenAI APIキーが必要です(設定から)" }
        var req = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(settings.openaiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let sys = "会議の自動文字起こし(誤認識を含む)を読み、聞き逃した人がすぐ追いつけるよう日本語で要約する。出力: 1) 今話している話題(1行) 2) 直近の要点(箇条書き3〜6個) 3) 決定事項/宿題(あれば) 4) 自分に振られていそうな質問(あれば)。誤認識と思われる語は文脈で補正してよい。"
        let body: [String: Any] = ["model": settings.summaryModel, "messages": [
            ["role": "system", "content": sys], ["role": "user", "content": String(text.suffix(20000))],
        ]]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let j = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = j["choices"] as? [[String: Any]], let msg = choices.first?["message"] as? [String: Any],
                  let content = msg["content"] as? String else {
                return "失敗(\(code)): \(String(data: data, encoding: .utf8)?.prefix(200) ?? "")"
            }
            if let u = j["usage"] as? [String: Any] {
                let pt = (u["prompt_tokens"] as? Double) ?? 0, ct = (u["completion_tokens"] as? Double) ?? 0
                session.usd += (pt * 0.25 + ct * 2) / 1_000_000
                costUSD = session.usd; save()
            }
            return content.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return "失敗: \(error.localizedDescription)"
        }
    }
}
