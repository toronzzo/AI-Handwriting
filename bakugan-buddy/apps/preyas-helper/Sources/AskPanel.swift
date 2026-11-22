import AppKit
import SwiftUI

struct Turn: Identifiable, Equatable {
  let id = UUID()
  var question: String
  var answer: String
}

@MainActor
final class HelperModel: ObservableObject {
  @Published var panelOpen = false
  @Published var buttonVisible = true
  @Published var bubbleOnLeft = false
  @Published var question = ""
  @Published var turns: [Turn] = []
  @Published var notice = ""
  @Published var errorText = ""
  @Published var leavesMac = false
  @Published var busy = false
  @Published var listening = false
  @Published var localReady = false
  @Published var keepLocal = false
  @Published var permissionNeeded = false
  @Published var imageJPEG: Data?
  @Published var recent: [RecentShot] = []

  var tapButton: @MainActor () -> Void = {}
  var hideButton: @MainActor () -> Void = {}
  var dragChanged: @MainActor (CGSize) -> Void = { _ in }
  var dragEnded: @MainActor (CGSize) -> Void = { _ in }
  var captureScreen: @MainActor () -> Void = {}
  var captureRegion: @MainActor () -> Void = {}
  var send: @MainActor () -> Void = {}
  var toggleMic: @MainActor () -> Void = {}
  var pickRecent: @MainActor (URL) -> Void = { _ in }
  var openPrivacy: @MainActor () -> Void = {}
  var keepLocalChanged: @MainActor (Bool) -> Void = { _ in }
}

struct AskRoot: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    let inset: CGFloat = model.panelOpen ? 8 : 0
    HStack(alignment: .top, spacing: 10) {
      if model.panelOpen && model.bubbleOnLeft {
        AskBubble(model: model)
      }
      AskButton(model: model)
      if model.panelOpen && !model.bubbleOnLeft {
        AskBubble(model: model)
      }
    }
    .padding(inset)
  }
}

private struct AskButton: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    Circle()
      .fill(Color(red: 0.18, green: 0.45, blue: 0.95))
      .frame(width: 56, height: 56)
      .overlay(mark)
      .shadow(color: .black.opacity(0.28), radius: 4, y: 2)
      .help("Ask Preyas about the screen")
      .accessibilityLabel("Preyas")
      .gesture(drag)
      .contextMenu {
        Button("This screen") { model.captureScreen() }
        Button("Select a region") { model.captureRegion() }
        Button("Hide") { model.hideButton() }
      }
  }

  private var mark: some View {
    Text("P")
      .font(.system(size: 22, weight: .bold))
      .foregroundStyle(.white)
  }

  private var drag: some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        model.dragChanged(value.translation)
      }
      .onEnded { value in
        model.dragEnded(value.translation)
      }
  }
}

private struct AskBubble: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !model.notice.isEmpty {
        NoticeBanner(model: model)
      }
      if !model.errorText.isEmpty {
        ErrorLine(model: model)
      }
      if model.permissionNeeded {
        PermissionButton(model: model)
      }
      if let data = model.imageJPEG, let image = NSImage(data: data) {
        ShotPreview(image: image)
      }
      TurnList(model: model)
      KeepLocalToggle(model: model)
      RecentShots(model: model)
      AskRow(model: model)
      CaptureRow(model: model)
    }
    .padding(10)
    .frame(width: 332)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
  }
}

private struct NoticeBanner: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    let tint: Color = model.leavesMac ? Color.orange.opacity(0.22) : Color.green.opacity(0.18)
    Text(model.notice)
      .font(.caption)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(6)
      .background(tint)
      .clipShape(RoundedRectangle(cornerRadius: 6))
  }
}

private struct ErrorLine: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    Text(model.errorText)
      .font(.caption)
      .foregroundStyle(.red)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct PermissionButton: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    Button("Open Screen Recording settings") { model.openPrivacy() }
      .font(.caption)
  }
}

private struct ShotPreview: View {
  let image: NSImage

  var body: some View {
    Image(nsImage: image)
      .resizable()
      .scaledToFit()
      .frame(maxHeight: 72)
      .clipShape(RoundedRectangle(cornerRadius: 6))
  }
}

private struct TurnList: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(model.turns) { turn in
          TurnTexts(turn: turn)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxHeight: 160)
  }
}

private struct TurnTexts: View {
  let turn: Turn

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(turn.question)
        .font(.caption)
        .foregroundStyle(.secondary)
      Text(turn.answer)
        .font(.body)
        .textSelection(.enabled)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct KeepLocalToggle: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    Toggle("Keep this picture on this Mac", isOn: $model.keepLocal)
      .font(.caption)
      .disabled(!model.localReady)
      .onChange(of: model.keepLocal) { _, on in
        model.keepLocalChanged(on)
      }
  }
}

private struct RecentShots: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    DisclosureGroup("Recent screenshots") {
      recentBody
    }
    .font(.caption)
  }

  @ViewBuilder
  private var recentBody: some View {
    if model.recent.isEmpty {
      Text("None in ~/Pictures/Screenshots yet. Cmd-Shift-5 can save them there.")
        .font(.caption)
        .foregroundStyle(.secondary)
    } else {
      shotButtons
    }
  }

  private var shotButtons: some View {
    ForEach(model.recent) { shot in
      RecentShotButton(model: model, shot: shot)
    }
  }
}

private struct RecentShotButton: View {
  @ObservedObject var model: HelperModel
  let shot: RecentShot

  var body: some View {
    Button(shot.name) { model.pickRecent(shot.url) }
      .font(.caption)
      .buttonStyle(.plain)
  }
}

private struct AskRow: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    HStack(spacing: 6) {
      questionField
      MicButton(model: model)
      askButton
    }
  }

  private var questionField: some View {
    TextField("Ask about this picture", text: $model.question)
      .textFieldStyle(.roundedBorder)
      .onSubmit { model.send() }
  }

  private var askTitle: String {
    if model.busy { return "…" }
    return "Ask"
  }

  private var canAsk: Bool {
    if model.busy { return false }
    if model.imageJPEG == nil { return false }
    let question: String = model.question.trimmingCharacters(in: .whitespacesAndNewlines)
    return !question.isEmpty
  }

  private var askButton: some View {
    Button(askTitle) { model.send() }
      .disabled(!canAsk)
  }
}

private struct MicButton: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    let listening: Bool = model.listening
    let symbol: String = listening ? "mic.fill" : "mic"
    let helpText: String = listening
      ? "Stop listening"
      : "Speak the question. Audio stays on this Mac."
    let label: String = listening ? "Stop listening" : "Speak"
    Button {
      model.toggleMic()
    } label: {
      Image(systemName: symbol)
    }
    .help(helpText)
    .accessibilityLabel(label)
  }
}

private struct CaptureRow: View {
  @ObservedObject var model: HelperModel

  var body: some View {
    HStack {
      Button("This screen") { model.captureScreen() }
      Button("Region") { model.captureRegion() }
      Spacer()
    }
    .font(.caption)
  }
}
