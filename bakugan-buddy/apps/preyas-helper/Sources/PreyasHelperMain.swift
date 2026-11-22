import AppKit
import Carbon.HIToolbox
import SwiftUI

private func preyasHotkeyHandler(
  _ next: EventHandlerCallRef?,
  _ event: EventRef?,
  _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
  _ = next
  _ = event
  guard let userData else { return noErr }
  let hotkey = Unmanaged<HotkeyController>.fromOpaque(userData).takeUnretainedValue()
  DispatchQueue.main.async {
    MainActor.assumeIsolated { hotkey.fire() }
  }
  return noErr
}

@MainActor
final class HotkeyController {
  var onFire: @MainActor () -> Void = {}
  private var hotKey: EventHotKeyRef?
  private var handler: EventHandlerRef?

  func install() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let pointer = Unmanaged.passUnretained(self).toOpaque()
    InstallEventHandler(GetApplicationEventTarget(), preyasHotkeyHandler, 1, &spec, pointer, &handler)
    let id = EventHotKeyID(signature: OSType(0x50525953), id: 1)
    RegisterEventHotKey(
      UInt32(kVK_ANSI_P),
      UInt32(controlKey | optionKey),
      id,
      GetApplicationEventTarget(),
      0,
      &hotKey
    )
  }

  func fire() { onFire() }
}

final class FloatPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

@MainActor
final class HelperController {
  let model = HelperModel()
  private let speech = SpeechInput()
  private var panel: FloatPanel?
  private var buttonOrigin = CGPoint(x: 40, y: 80)
  private var dragAnchor: CGPoint?
  private let buttonSize: CGFloat = 56

  func start() {
    wire()
    loadPosition()
    let host = NSHostingView(rootView: AskRoot(model: model))
    let panel = FloatPanel(
      contentRect: NSRect(x: buttonOrigin.x, y: buttonOrigin.y, width: buttonSize, height: buttonSize),
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isMovable = false
    panel.contentView = host
    self.panel = panel
    place()
    panel.orderFrontRegardless()
  }

  func toggleVisible() {
    model.buttonVisible.toggle()
    if model.buttonVisible {
      model.panelOpen = false
      place()
      panel?.orderFrontRegardless()
    } else {
      speech.stop()
      model.listening = false
      model.panelOpen = false
      panel?.orderOut(nil)
    }
  }

  func captureScreen() {
    let point = buttonCenter()
    Task { @MainActor in
      self.panel?.orderOut(nil)
      try? await Task.sleep(nanoseconds: 200_000_000)
      do {
        let data = try await ScreenGrab.capture(around: point)
        self.showAsk(data: data)
      } catch {
        self.showFailure(error)
      }
    }
  }

  func captureRegion() {
    Task { @MainActor in
      self.panel?.orderOut(nil)
      do {
        let data = try await ScreenGrab.captureRegion()
        self.showAsk(data: data)
      } catch CaptureError.cancelled {
        self.restoreChrome()
        self.model.errorText = ""
      } catch {
        self.showFailure(error)
      }
    }
  }

  func askAboutFile(_ url: URL) {
    do {
      showAsk(data: try ScreenGrab.jpeg(from: url))
    } catch {
      model.errorText = String(describing: error)
      model.permissionNeeded = false
      openPanel()
    }
  }

  func send() {
    let question = model.question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let jpeg = model.imageJPEG, !question.isEmpty, !model.busy else { return }
    speech.stop()
    model.listening = false
    let history = model.turns.flatMap {
      [HistoryTurn(role: "user", content: $0.question), HistoryTurn(role: "assistant", content: $0.answer)]
    }
    let prefer = model.keepLocal ? "local" : "auto"
    model.question = ""
    model.busy = true
    model.errorText = ""
    Task { @MainActor in
      do {
        let client = try self.client()
        let payload = try await client.ask(question: question, jpeg: jpeg, history: history, prefer: prefer)
        self.model.turns.append(Turn(question: question, answer: payload.answer ?? ""))
        self.model.notice = payload.notice ?? ""
        self.model.leavesMac = payload.leavesMac ?? false
        self.model.busy = false
      } catch {
        self.model.question = question
        self.model.errorText = error.localizedDescription
        self.model.busy = false
      }
    }
  }

  private func wire() {
    model.tapButton = { [weak self] in self?.tap() }
    model.hideButton = { [weak self] in self?.hide() }
    model.dragChanged = { [weak self] translation in self?.dragChanged(translation) }
    model.dragEnded = { [weak self] translation in self?.dragEnded(translation) }
    model.captureScreen = { [weak self] in self?.captureScreen() }
    model.captureRegion = { [weak self] in self?.captureRegion() }
    model.send = { [weak self] in self?.send() }
    model.toggleMic = { [weak self] in self?.toggleMic() }
    model.pickRecent = { [weak self] url in self?.askAboutFile(url) }
    model.openPrivacy = { ScreenGrab.openScreenRecordingSettings() }
    model.keepLocalChanged = { [weak self] on in self?.keepLocalChanged(on) }
  }

  private func tap() {
    if model.panelOpen {
      closePanel()
    } else {
      captureScreen()
    }
  }

  private func hide() {
    model.buttonVisible = false
    model.panelOpen = false
    speech.stop()
    model.listening = false
    panel?.orderOut(nil)
  }

  private func dragChanged(_ translation: CGSize) {
    if dragAnchor == nil { dragAnchor = buttonOrigin }
    guard let anchor = dragAnchor else { return }
    guard hypot(translation.width, translation.height) > 4 else { return }
    buttonOrigin = CGPoint(x: anchor.x + translation.width, y: anchor.y - translation.height)
    place()
  }

  private func dragEnded(_ translation: CGSize) {
    let moved = hypot(translation.width, translation.height) > 4
    if moved {
      savePosition()
    } else if let anchor = dragAnchor {
      buttonOrigin = anchor
      place()
      tap()
    }
    dragAnchor = nil
  }

  private func showAsk(data: Data) {
    model.imageJPEG = data
    model.turns = []
    model.question = ""
    model.errorText = ""
    model.permissionNeeded = false
    model.recent = ScreenGrab.recentShots()
    openPanel()
    Task { @MainActor in await self.refreshStatus() }
  }

  private func showFailure(_ error: Error) {
    model.permissionNeeded = String(describing: error).contains("Screen Recording")
    model.errorText = (error as? CaptureError)?.description ?? error.localizedDescription
    model.recent = ScreenGrab.recentShots()
    openPanel()
  }

  private func openPanel() {
    model.buttonVisible = true
    model.panelOpen = true
    place()
    NSApp.activate(ignoringOtherApps: true)
    panel?.makeKeyAndOrderFront(nil)
  }

  private func closePanel() {
    model.panelOpen = false
    speech.stop()
    model.listening = false
    place()
    panel?.orderFrontRegardless()
  }

  private func restoreChrome() {
    if model.buttonVisible {
      place()
      panel?.orderFrontRegardless()
    }
  }

  private func refreshStatus() async {
    do {
      let payload = try await client().status()
      if model.keepLocal && model.localReady {
        return
      }
      model.notice = payload.notice ?? ""
      model.leavesMac = payload.leavesMac ?? false
      model.localReady = payload.localReady ?? false
      if !model.localReady { model.keepLocal = false }
    } catch {
      model.notice = ""
      model.errorText = error.localizedDescription
      model.leavesMac = false
    }
  }

  private func keepLocalChanged(_ on: Bool) {
    if on {
      model.notice = "The next answer will use a local vision model. The picture will stay on this Mac."
      model.leavesMac = false
    } else {
      Task { @MainActor in await self.refreshStatus() }
    }
  }

  private func toggleMic() {
    if speech.listening || model.listening {
      speech.stop()
      model.listening = false
      return
    }
    model.listening = true
    speech.toggle(currentText: model.question, onText: { [weak self] text in
      self?.model.question = text
    }, onError: { [weak self] message in
      self?.model.errorText = message
      self?.model.listening = false
    })
  }

  private func client() throws -> BrainClient {
    switch BrainClient.load() {
    case .success(let client):
      return client
    case .failure(let error):
      throw error
    }
  }

  private func buttonCenter() -> CGPoint {
    CGPoint(x: buttonOrigin.x + buttonSize / 2, y: buttonOrigin.y + buttonSize / 2)
  }

  private func place() {
    let screen = NSScreen.screens.first { $0.frame.contains(buttonOrigin) } ?? NSScreen.main
    let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
    buttonOrigin.x = min(max(buttonOrigin.x, visible.minX), visible.maxX - buttonSize)
    buttonOrigin.y = min(max(buttonOrigin.y, visible.minY), visible.maxY - buttonSize)
    let bubble = NSSize(width: 332, height: 460)
    let bubbleOnLeft = buttonOrigin.x + buttonSize / 2 > visible.midX
    model.bubbleOnLeft = bubbleOnLeft
    let frame: NSRect
    if model.panelOpen {
      let width = bubble.width + 10 + buttonSize + 16
      let height = bubble.height + 16
      let x = bubbleOnLeft ? buttonOrigin.x - 10 - bubble.width - 8 : buttonOrigin.x - 8
      let y = buttonOrigin.y + buttonSize - height + 8
      frame = clamp(NSRect(x: x, y: y, width: width, height: height), in: visible)
    } else {
      frame = NSRect(x: buttonOrigin.x, y: buttonOrigin.y, width: buttonSize, height: buttonSize)
    }
    panel?.setFrame(frame, display: true)
  }

  private func clamp(_ rect: NSRect, in visible: NSRect) -> NSRect {
    var next = rect
    if next.width > visible.width { next.size.width = visible.width }
    if next.height > visible.height { next.size.height = visible.height }
    if next.maxX > visible.maxX { next.origin.x = visible.maxX - next.width }
    if next.maxY > visible.maxY { next.origin.y = visible.maxY - next.height }
    if next.minX < visible.minX { next.origin.x = visible.minX }
    if next.minY < visible.minY { next.origin.y = visible.minY }
    return next
  }

  private func loadPosition() {
    let defaults = UserDefaults.standard
    if defaults.object(forKey: "preyas.helper.buttonX") != nil {
      buttonOrigin = CGPoint(
        x: defaults.double(forKey: "preyas.helper.buttonX"),
        y: defaults.double(forKey: "preyas.helper.buttonY")
      )
      return
    }
    let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
    buttonOrigin = CGPoint(x: visible.maxX - buttonSize - 16, y: visible.midY)
  }

  private func savePosition() {
    UserDefaults.standard.set(buttonOrigin.x, forKey: "preyas.helper.buttonX")
    UserDefaults.standard.set(buttonOrigin.y, forKey: "preyas.helper.buttonY")
  }
}

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let controller = HelperController()
  private let hotkey = HotkeyController()
  private var statusItem: NSStatusItem?
  private let recentMenu = NSMenu()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    controller.start()
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    if let image = NSImage(systemSymbolName: "circle.circle.fill", accessibilityDescription: "Preyas") {
      image.isTemplate = true
      item.button?.image = image
    } else {
      item.button?.title = "P"
    }
    let menu = NSMenu()
    menu.delegate = self
    menu.addItem(item("Ask about this screen", action: #selector(askScreen)))
    menu.addItem(item("Select a region", action: #selector(askRegion)))
    let recent = NSMenuItem(title: "Recent screenshots", action: nil, keyEquivalent: "")
    recent.submenu = recentMenu
    menu.addItem(recent)
    menu.addItem(.separator())
    menu.addItem(item("Hide or show the button    ⌃⌥P", action: #selector(toggleButton)))
    menu.addItem(item("Quit Preyas Helper", action: #selector(quit)))
    item.menu = menu
    statusItem = item
    hotkey.onFire = { [weak self] in
      self?.controller.toggleVisible()
    }
    hotkey.install()
  }

  func menuWillOpen(_ menu: NSMenu) {
    recentMenu.removeAllItems()
    let shots = ScreenGrab.recentShots()
    if shots.isEmpty {
      let empty = NSMenuItem(title: "No screenshots in Pictures/Screenshots", action: nil, keyEquivalent: "")
      empty.isEnabled = false
      recentMenu.addItem(empty)
      return
    }
    for shot in shots {
      let entry = NSMenuItem(title: shot.name, action: #selector(openRecent(_:)), keyEquivalent: "")
      entry.target = self
      entry.representedObject = shot.url
      recentMenu.addItem(entry)
    }
  }

  @objc private func askScreen() { controller.captureScreen() }
  @objc private func askRegion() { controller.captureRegion() }
  @objc private func toggleButton() { controller.toggleVisible() }
  @objc private func quit() { NSApp.terminate(nil) }

  @objc private func openRecent(_ sender: NSMenuItem) {
    guard let url = sender.representedObject as? URL else { return }
    controller.askAboutFile(url)
  }

  private func item(_ title: String, action: Selector) -> NSMenuItem {
    let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
    entry.target = self
    return entry
  }
}
