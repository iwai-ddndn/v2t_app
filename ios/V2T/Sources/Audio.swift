import AVFoundation

let sampleRate = 16000.0

func rms(_ s: [Int16]) -> Double {
    if s.isEmpty { return 0 }
    var acc = 0.0
    for v in s { let f = Double(v) / 32768.0; acc += f * f }
    return (acc / Double(s.count)).squareRoot()
}

func encodeWav(_ pcm: [Int16], rate: Int = 16000) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
    func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
    let bytes = UInt32(pcm.count * 2)
    d.append("RIFF".data(using: .ascii)!); u32(36 + bytes); d.append("WAVE".data(using: .ascii)!)
    d.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
    d.append("data".data(using: .ascii)!); u32(bytes)
    pcm.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
    return d
}

/// 直近 N 秒の音声を保持(聞き直し用)
final class RingBuffer {
    private var buf: [Int16]
    private var pos = 0
    private(set) var filled = 0
    let cap: Int
    private let lock = NSLock()

    init(seconds: Int) {
        cap = max(1, seconds) * Int(sampleRate)
        buf = Array(repeating: 0, count: cap)
    }
    func push(_ s: [Int16]) {
        lock.withLock {
            let src = s.count > cap ? Array(s.suffix(cap)) : s
            for v in src { buf[pos] = v; pos = (pos + 1) % cap }
            filled = min(cap, filled + src.count)
        }
    }
    func last(seconds: Double) -> [Int16] {
        lock.withLock {
            let n = min(filled, Int(seconds * sampleRate))
            var out = [Int16](); out.reserveCapacity(n)
            var i = (pos - n + cap) % cap
            for _ in 0..<n { out.append(buf[i]); i = (i + 1) % cap }
            return out
        }
    }
}

func dbfs(_ r: Double) -> Double { 20 * log10(max(r, 1e-6)) }

/// 適応型の発話検出。ノイズフロア = 直近5秒の 100ms ごとの音量の最小値(Minimum Statistics の簡易版)。
/// 固定しきい値と違い、スピーカー越しの小さな声も「雑音より 8dB 以上大きい」なら発話として扱う。
final class Vad {
    private var win: [Double] = []
    private let winLen = 50, marginDb = 8.0, absMinDb = -65.0, hangFrames = 3
    private var hang = 0
    func push(_ s: [Int16]) -> (speech: Bool, levelDb: Double) {
        let lv = dbfs(rms(s))
        win.append(lv)
        if win.count > winLen { win.removeFirst() }
        let floor = max(-90, win.min() ?? -90)
        let raw = lv > floor + marginDb && lv > absMinDb
        if raw { hang = hangFrames } else if hang > 0 { hang -= 1 }
        return (raw || hang > 0, lv)
    }
}

/// 80Hz ハイパス(線形処理なので認識を邪魔する歪みを生まない)
struct HighPass {
    private let a: Double
    private var px = 0.0, py = 0.0
    init(cutoff: Double = 80) { let rc = 1 / (2 * Double.pi * cutoff); a = rc / (rc + 1 / sampleRate) }
    mutating func process(_ x: [Double]) -> [Double] {
        var out = [Double](repeating: 0, count: x.count)
        for i in 0..<x.count { py = a * (py + x[i] - px); px = x[i]; out[i] = py }
        return out
    }
}

private func toInt16(_ v: Double) -> Int16 {
    let c = max(-1, min(1, v))
    return Int16(c < 0 ? c * 32768 : c * 32767)
}

/// 区間単位の音量正規化: 話している部分の音量を約 -20dBFS に(最大 +26dB)。ピークは 0.95 まで。
func normalizeGain(_ pcm: [Int16], targetRms: Double = 0.1, maxGain: Double = 20) -> [Int16] {
    if pcm.isEmpty { return pcm }
    var hp = HighPass()
    let f = hp.process(pcm.map { Double($0) / 32768 })
    var pw: [Double] = []
    var i = 0
    while i < f.count {
        let e = min(f.count, i + 1600)
        var s = 0.0
        for j in i..<e { s += f[j] * f[j] }
        pw.append(s / Double(max(1, e - i)))
        i = e
    }
    pw.sort(by: >)
    let top = pw.prefix(max(1, (pw.count + 1) / 2))
    let speechRms = (top.reduce(0, +) / Double(top.count)).squareRoot()
    var gain = min(maxGain, max(0.5, targetRms / max(speechRms, 1e-5)))
    let abs = f.map { Swift.abs($0) }.sorted()
    let p999 = abs[min(abs.count - 1, Int(Double(abs.count) * 0.999))]
    if p999 * gain > 0.95 { gain = 0.95 / max(p999, 1e-5) }
    return f.map { toInt16($0 * gain) }
}

/// ストリーミング用(Soniox): ハイパス + ゆっくり動く自動音量調整(1フレーム ±1dB まで)
final class StreamingLeveler {
    private var hp = HighPass()
    private let vad = Vad()
    private var speechPow: Double?
    private var gain = 1.0
    func process(_ pcm: [Int16]) -> [Int16] {
        let f = hp.process(pcm.map { Double($0) / 32768 })
        if vad.push(pcm).speech {
            let p = f.reduce(0) { $0 + $1 * $1 } / Double(max(1, f.count))
            speechPow = speechPow.map { $0 * 0.9 + p * 0.1 } ?? p
        }
        let want = speechPow.map { min(20, max(0.5, 0.1 / $0.squareRoot())) } ?? 1
        gain = min(gain * 1.122, max(gain / 1.122, want))
        return f.map { x -> Int16 in
            var y = x * gain
            if Swift.abs(y) > 0.9 { y = (y > 0 ? 1 : -1) * (0.9 + 0.1 * tanh((Swift.abs(y) - 0.9) / 0.1)) }
            return toInt16(y)
        }
    }
}

/// 発話の切れ目で区切る。maxSec に達したら直近3秒で一番静かな位置で区切る。発話 0.3 秒未満の区間は送らない。
final class Chunker {
    let minSec: Double, maxSec: Double, silenceSec = 0.4, minSpeechSec = 0.3
    private struct Frame { let pcm: [Int16]; let speech: Bool; let db: Double }
    private var frames: [Frame] = []
    private var samples = 0, silent = 0, startSample = 0
    private let vad = Vad()
    let onChunk: ([Int16], Double, Double) -> Void   // pcm, 開始秒, 発話率

    init(minSec: Double, maxSec: Double, onChunk: @escaping ([Int16], Double, Double) -> Void) {
        self.minSec = minSec; self.maxSec = maxSec; self.onChunk = onChunk
    }
    func push(_ s: [Int16]) {
        let v = vad.push(s)
        frames.append(Frame(pcm: s, speech: v.speech, db: v.levelDb))
        samples += s.count
        if v.speech { silent = 0 } else { silent += s.count }
        let sec = Double(samples) / sampleRate
        if sec >= minSec && Double(silent) >= silenceSec * sampleRate { flush() }
        else if sec >= maxSec { flush(count: quietestCut()) }
    }
    private func quietestCut() -> Int {
        var acc = 0, best = frames.count - 1, bestDb = Double.infinity
        var i = frames.count - 1
        while i >= 1 {
            acc += frames[i].pcm.count
            if Double(acc) > 3 * sampleRate { break }
            if frames[i].db < bestDb { bestDb = frames[i].db; best = i }
            i -= 1
        }
        return best + 1
    }
    func flush(count: Int? = nil) {
        guard !frames.isEmpty else { return }
        let n = min(count ?? frames.count, frames.count)
        let take = Array(frames.prefix(n))
        frames.removeFirst(n)
        let len = take.reduce(0) { $0 + $1.pcm.count }
        let speechLen = take.reduce(0) { $0 + ($1.speech ? $1.pcm.count : 0) }
        let st = Double(startSample) / sampleRate
        startSample += len
        samples -= len
        silent = 0
        for f in frames.reversed() { if f.speech { break }; silent += f.pcm.count }
        if Double(speechLen) < minSpeechSec * sampleRate { return }
        onChunk(take.flatMap { $0.pcm }, st, Double(speechLen) / Double(max(1, len)))
    }
}

/// マイク入力を 16kHz mono Int16 に変換して流す。
/// UIBackgroundModes=audio + playAndRecord なので、画面ロック中・他アプリ使用中も録音が続く。
final class AudioCapture {
    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true)!
    private var observers: [NSObjectProtocol] = []
    var onFrame: (([Int16]) -> Void)?
    var onStatus: ((String) -> Void)?

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
        try session.setActive(true)
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0 else { throw AppError("マイクが使えません") }
        converter = AVAudioConverter(from: inFormat, to: outFormat)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buf, _ in self?.convert(buf) }
        engine.prepare()
        try engine.start()
        observeInterruptions()
    }

    func stop() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func convert(_ buf: AVAudioPCMBuffer) {
        guard let conv = converter else { return }
        let ratio = outFormat.sampleRate / buf.format.sampleRate
        let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buf
        }
        guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
        onFrame?(Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength))))
    }

    /// 電話・Siri などで中断されたら、終了後に自動で録音を再開する
    private func observeInterruptions() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self.onStatus?("⚠ 中断されました(通話など)。終わったら自動で再開します")
            } else {
                try? AVAudioSession.sharedInstance().setActive(true)
                do { try self.engine.start(); self.onStatus?("録音を再開しました") }
                catch { self.onStatus?("再開できません: \(error.localizedDescription)") }
            }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            try? self.start()
        })
    }
}
