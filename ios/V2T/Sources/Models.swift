import Foundation

struct Segment: Identifiable, Codable, Equatable {
    var id = UUID()
    var t: Double          // 録音開始からの秒数
    var text: String
    var speaker: String?
}

struct AppError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

/// エンジン → 画面 への通知(どのスレッドから呼ばれてもよい。Recorder 側でメインスレッドへ移す)
struct EngineCallbacks {
    let onSegment: (Segment) -> Void
    let onInterim: (String) -> Void
    let onStatus: (String) -> Void
}

protocol TranscriptionEngine: AnyObject {
    var displayName: String { get }
    var costPerMinute: Double { get }   // USD
    func start() async throws
    func feed(_ pcm: [Int16])            // 16kHz mono Int16。オーディオスレッドから呼ばれる
    func stop() async -> Double          // 課金対象の秒数を返す
}

enum EngineKind: String, CaseIterable, Identifiable, Codable {
    case openai, soniox
    var id: String { rawValue }
    var label: String { self == .openai ? "OpenAI" : "Soniox" }
}

func fmtTime(_ sec: Double) -> String {
    let s = max(0, Int(sec))
    let h = s / 3600, m = (s % 3600) / 60, r = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%02d:%02d", m, r)
}

func plainText(_ segs: [Segment], withTime: Bool = true) -> String {
    segs.map { s in
        (withTime ? "[\(fmtTime(s.t))] " : "") + (s.speaker.map { "話者\($0): " } ?? "") + s.text
    }.joined(separator: "\n")
}
