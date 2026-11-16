import SwiftUI

@main
@MainActor
struct V2TApp: App {
    @StateObject private var settings: SettingsStore
    @StateObject private var recorder: Recorder

    init() {
        let s = SettingsStore()
        _settings = StateObject(wrappedValue: s)
        _recorder = StateObject(wrappedValue: Recorder(settings: s))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(recorder)
                .preferredColorScheme(.dark)
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var rec: Recorder
    @EnvironmentObject var settings: SettingsStore
    @State private var showSettings = false
    @State private var showSummary = false
    @State private var showListen = false
    @State private var follow = true
    @State private var target: Segment.ID?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("方式", selection: $settings.engine) {
                    ForEach(EngineKind.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 170)
                .disabled(rec.running)
                Spacer()
                Text(fmtTime(rec.elapsed)).monospacedDigit().bold()
                Text("¥\(Int((rec.costUSD * settings.yenPerUsd).rounded()))").font(.caption).foregroundStyle(.secondary)
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
            }
            .padding(.horizontal).padding(.vertical, 8)

            Text(rec.status).font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        if rec.segments.isEmpty {
                            Text("「● 開始」で録音と文字起こしを始めます。\n画面を消したり他のアプリを使っても録音は続きます。")
                                .foregroundStyle(.secondary).multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity).padding(.top, 120)
                        }
                        ForEach(rec.segments) { s in
                            SegmentRow(seg: s,
                                       highlighted: rec.highlightFrom.map { s.t >= $0 } ?? false,
                                       isTarget: s.id == target,
                                       fontSize: settings.fontSize)
                                .id(s.id)
                        }
                        if !rec.interim.isEmpty {
                            Text(rec.interim).font(.system(size: settings.fontSize * 0.9)).foregroundStyle(.secondary)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 10)
                }
                .onChange(of: rec.segments.count) { _, _ in
                    if follow { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                }
                .onChange(of: rec.interim) { _, _ in
                    if follow { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: target) { _, id in
                    if let id { withAnimation { proxy.scrollTo(id, anchor: .top) } }
                }
                .overlay(alignment: .bottomTrailing) {
                    if !follow {
                        Button("最新へ ↓") {
                            follow = true; target = nil; rec.highlightFrom = nil
                            withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                        }
                        .buttonStyle(.borderedProminent).padding()
                    }
                }
            }

            Divider()
            HStack(spacing: 6) {
                ForEach([30, 60, 180, 300], id: \.self) { sec in
                    Button { follow = false; target = rec.rewind(Double(sec)) } label: {
                        Text(sec < 60 ? "◀ \(sec)秒" : "◀ \(sec / 60)分").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, 10).padding(.top, 8)
            HStack(spacing: 6) {
                Button { showListen = true } label: { Text("🔊 聞き直す").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                Button {
                    Task { if rec.running { await rec.stop() } else { await rec.start() } }
                } label: {
                    Text(rec.running ? "■ 停止" : (rec.segments.isEmpty ? "● 開始" : "● 再開"))
                        .bold().frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent).tint(rec.running ? .gray : .red)
                Button { showSummary = true } label: { Text("🧠 要約").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
            }
            .padding(10)
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showSummary) { SummaryView().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showListen) { ListenView().presentationDetents([.height(220)]) }
    }
}

struct SegmentRow: View {
    let seg: Segment
    let highlighted: Bool
    let isTarget: Bool
    let fontSize: Double

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(fmtTime(seg.t)).font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(minWidth: 44, alignment: .leading)
            if let sp = seg.speaker { Text("話者\(sp)").font(.caption).foregroundStyle(.blue) }
            Text(seg.text).font(.system(size: fontSize)).textSelection(.enabled)
        }
        .padding(.vertical, 3).padding(.horizontal, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(highlighted ? Color.green.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isTarget ? Color.green : Color.clear, lineWidth: 2))
    }
}

struct ListenView: View {
    @EnvironmentObject var rec: Recorder
    var body: some View {
        VStack(spacing: 14) {
            Text("直近の音声を聞き直す").font(.headline)
            Text("イヤホン推奨。録音は続いたまま再生します。").font(.caption).foregroundStyle(.secondary)
            HStack {
                ForEach([15, 30, 60, 180], id: \.self) { s in
                    Button(s < 60 ? "\(s)秒" : "\(s / 60)分") { rec.play(last: Double(s)) }.buttonStyle(.bordered)
                }
                Button("■") { rec.stopPlaying() }.buttonStyle(.bordered)
            }
        }
        .padding()
    }
}

struct SummaryView: View {
    @EnvironmentObject var rec: Recorder
    @State private var range = 300.0
    @State private var output = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Picker("範囲", selection: $range) {
                    Text("3分").tag(180.0); Text("5分").tag(300.0); Text("10分").tag(600.0); Text("全体").tag(0.0)
                }
                .pickerStyle(.segmented)
                Button {
                    busy = true; output = "要約中…"
                    Task { output = await rec.summarize(range: range); busy = false }
                } label: { Text("要約する").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).disabled(busy)
                ScrollView { Text(output).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
            }
            .padding()
            .navigationTitle("直近の要約").navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var settings: SettingsStore
    @EnvironmentObject var rec: Recorder
    @Environment(\.dismiss) private var dismiss
    @State private var confirmClear = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("小さい声を自動で大きくする(推奨)", isOn: $settings.normalize)
                    TextField("用語・固有名詞(「、」区切り。人名・社名・専門用語など)", text: $settings.glossary, axis: .vertical)
                        .lineLimit(2...5).autocorrectionDisabled()
                } header: { Text("音声・認識のヒント") } footer: {
                    Text("PCのスピーカーから流れる会議は、iPhoneをスピーカーの近く(30cm以内が目安)に置くと精度が上がります。")
                }
                Section("OpenAI(ChatGPT Pro の API クレジットが使えます)") {
                    SecureField("APIキー sk-...", text: $settings.openaiKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Picker("文字起こしモデル", selection: $settings.openaiModel) {
                        Text("gpt-transcribe($0.0045/分・最新・推奨)").tag("gpt-transcribe")
                        Text("gpt-4o-transcribe($0.006/分)").tag("gpt-4o-transcribe")
                        Text("gpt-4o-mini-transcribe($0.003/分・最安)").tag("gpt-4o-mini-transcribe")
                        Text("whisper-1($0.006/分・旧)").tag("whisper-1")
                    }
                    Stepper("区切り 最短 \(Int(settings.chunkMin))秒", value: $settings.chunkMin, in: 3...30)
                    Stepper("区切り 最長 \(Int(settings.chunkMax))秒", value: $settings.chunkMax, in: 5...60)
                    TextField("要約モデル", text: $settings.summaryModel).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section("Soniox(即時表示・最安クラス)") {
                    SecureField("APIキー", text: $settings.sonioxKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("モデル", text: $settings.sonioxModel).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("話者分離", isOn: $settings.diarize)
                }
                Section("表示・その他") {
                    Stepper("文字サイズ \(Int(settings.fontSize))", value: $settings.fontSize, in: 12...32)
                    Stepper("聞き直し用の音声保持 \(settings.ringMinutes)分", value: $settings.ringMinutes, in: 1...30)
                    Stepper("為替 \(Int(settings.yenPerUsd))円/ドル", value: $settings.yenPerUsd, in: 80...300, step: 5)
                }
                Section("記録") {
                    ShareLink("現在の記録を書き出す", item: plainText(rec.segments))
                    Button("現在の記録を履歴に移して新規開始", role: .destructive) { confirmClear = true }
                        .disabled(rec.running || rec.segments.isEmpty)
                    ForEach(rec.history, id: \.self) { url in
                        ShareLink(url.deletingPathExtension().lastPathComponent, item: url)
                    }
                }
                Section {
                    Text("記録・APIキーはこの iPhone 内にのみ保存されます(キーは Keychain)。音声は選んだ API(OpenAI / Soniox)へ直接送信されます。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("設定").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("閉じる") { dismiss() } }
            .confirmationDialog("現在の記録を履歴に移して、新しい記録を始めますか?", isPresented: $confirmClear, titleVisibility: .visible) {
                Button("移して新規開始", role: .destructive) { rec.archiveAndReset() }
            }
        }
    }
}
