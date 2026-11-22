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
    HStack(alignment: .top, spacing: 10) {
      if model.panelOpen && model.bubbleOnLeft { bubble }
      button
      if model.panelOpen && !model.bubbleOnLeft { bubble }
    }
    .padding(model.panelOpen ? 8 : 0)
  }

  private var button: some View {
    Circle()
      .fill(Color(red: 0.18, green: 0.45, blue: 0.95))
      .frame(width: 56, height: 56)
      .overlay(Text("P").font(.system(size: 22, weight: .bold)).foregroundStyle(.white))
      .shadow(color: .black.opacity(0.28), radius: 4, y: 2)
      .help("Ask Preyas about the screen")
      .accessibilityLabel("Preyas")
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { value in
            model.dragChanged(value.translation)
          }
          .onEnded { value in
            model.dragEnded(value.translation)
          }
      )
      .contextMenu {
        Button("This screen") { model.captureScreen() }
        Button("Select a region") { model.captureRegion() }
        Button("Hide") { model.hideButton() }
      }
  }

  private var bubble: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !model.notice.isEmpty {
        Text(model.notice)
          .font(.caption)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(6)
          .background(model.leavesMac ? Color.orange.opacity(0.22) : Color.green.opacity(0.18))
          .clipShape(RoundedRectangle(cornerRadius: 6))
      }
      if !model.errorText.isEmpty {
        Text(model.errorText)
          .font(.caption)
          .foregroundStyle(.red)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      if model.permissionNeeded {
        Button("Open Screen Recording settings") { model.openPrivacy() }
          .font(.caption)
      }
      if let data = model.imageJPEG, let image = NSImage(data: data) {
        Image(nsImage: image)
          .resizable()
          .scaledToFit()
          .frame(maxHeight: 72)
          .clipShape(RoundedRectangle(cornerRadius: 6))
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(model.turns) { turn in
            Text(turn.question).font(.caption).foregroundStyle(.secondary)
            Text(turn.answer).font(.body).textSelection(.enabled)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(maxHeight: 160)
      Toggle("Keep this picture on this Mac", isOn: $model.keepLocal)
        .font(.caption)
        .disabled(!model.localReady)
        .onChange(of: model.keepLocal) { _, on in
          model.keepLocalChanged(on)
        }
      DisclosureGroup("Recent screenshots") {
        if model.recent.isEmpty {
          Text("None in ~/Pictures/Screenshots yet. Cmd-Shift-5 can save them there.")
            .font(.caption)
            .foregroundStyle(.secondary)
        } else {
          ForEach(model.recent) { shot in
            Button(shot.name) { model.pickRecent(shot.url) }
              .font(.caption)
              .buttonStyle(.plain)
          }
        }
      }
      .font(.caption)
      HStack(spacing: 6) {
        TextField("Ask about this picture", text: $model.question)
          .textFieldStyle(.roundedBorder)
          .onSubmit { model.send() }
        Button {
          model.toggleMic()
        } label: {
          Image(systemName: model.listening ? "mic.fill" : "mic")
        }
        .help(model.listening ? "Stop listening" : "Speak the question. Audio stays on this Mac.")
        .accessibilityLabel(model.listening ? "Stop listening" : "Speak")
        Button(model.busy ? "…" : "Ask") { model.send() }
          .disabled(model.busy || model.imageJPEG == nil || model.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      HStack {
        Button("This screen") { model.captureScreen() }
        Button("Region") { model.captureRegion() }
        Spacer()
      }
      .font(.caption)
    }
    .padding(10)
    .frame(width: 332)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
  }
}
