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

/// 無音位置で区切る(minSec 以上たまったら無音で区切り、maxSec で強制区切り)
final class Chunker {
    let minSec: Double, maxSec: Double, silenceSec = 0.5, silenceRms = 0.012
    private var parts: [Int16] = []
    private var silent = 0
    private var startSample = 0
    let onChunk: ([Int16], Double) -> Void

    init(minSec: Double, maxSec: Double, onChunk: @escaping ([Int16], Double) -> Void) {
        self.minSec = minSec; self.maxSec = maxSec; self.onChunk = onChunk
    }
    func push(_ s: [Int16]) {
        parts += s
        if rms(s) < silenceRms { silent += s.count } else { silent = 0 }
        let sec = Double(parts.count) / sampleRate
        if (sec >= minSec && Double(silent) >= silenceSec * sampleRate) || sec >= maxSec { flush() }
    }
    func flush() {
        guard !parts.isEmpty else { return }
        let pcm = parts
        let st = Double(startSample) / sampleRate
        startSample += parts.count
        parts = []; silent = 0
        if rms(pcm) < silenceRms * 0.6 { return }   // ほぼ無音は送らない(課金節約)
        onChunk(pcm, st)
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
