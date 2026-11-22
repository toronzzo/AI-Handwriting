import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum CaptureError: Error, CustomStringConvertible {
  case permission
  case cancelled
  case failed(String)

  var description: String {
    switch self {
    case .permission:
      return "Preyas needs Screen Recording permission. Turn on Preyas Helper in System Settings → Privacy & Security → Screen Recording, then tap the button again."
    case .cancelled:
      return "Selection cancelled."
    case .failed(let message):
      return message
    }
  }
}

struct RecentShot: Identifiable, Hashable, Sendable {
  var id: String { url.path }
  let url: URL
  let name: String
  let modified: Date
}

enum ScreenGrab {
  static let screenshotsDirectory = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Pictures/Screenshots", isDirectory: true)

  static func recentShots(limit: Int = 10) -> [RecentShot] {
    let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
    guard let urls = try? FileManager.default.contentsOfDirectory(
      at: screenshotsDirectory,
      includingPropertiesForKeys: Array(keys),
      options: [.skipsHiddenFiles]
    ) else {
      return []
    }
    let allowed: Set<String> = ["png", "jpg", "jpeg", "webp", "gif"]
    return urls.compactMap { url -> RecentShot? in
      guard allowed.contains(url.pathExtension.lowercased()) else { return nil }
      let values = try? url.resourceValues(forKeys: keys)
      guard values?.isRegularFile == true else { return nil }
      return RecentShot(url: url, name: url.lastPathComponent, modified: values?.contentModificationDate ?? .distantPast)
    }
    .sorted { $0.modified > $1.modified }
    .prefix(limit)
    .map { $0 }
  }

  /// The display under `point` (AppKit coordinates, y up). The caller hides
  /// Preyas's own windows first so the button is not in the picture.
  static func capture(around point: CGPoint) async throws -> Data {
    try ensurePermission()
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = display(for: point, in: content) else {
      throw CaptureError.failed("No display to capture.")
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let config = SCStreamConfiguration()
    config.width = max(1, display.width)
    config.height = max(1, display.height)
    config.showsCursor = true
    config.capturesAudio = false
    let image: CGImage
    do {
      image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    } catch {
      if !CGPreflightScreenCaptureAccess() { throw CaptureError.permission }
      throw CaptureError.failed("Screen capture failed. Check Screen Recording permission for Preyas Helper.")
    }
    guard let data = jpegData(downscale(image, maxEdge: 1280), quality: 0.62) else {
      throw CaptureError.failed("Could not encode the screenshot.")
    }
    return data
  }

  /// Interactive region selection via the system screencapture tool.
  static func captureRegion() async throws -> Data {
    try ensurePermission()
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("preyas-region-\(UUID().uuidString).jpg")
    defer { try? FileManager.default.removeItem(at: url) }
    let code: Int32 = try await Task.detached {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
      process.arguments = ["-i", "-s", "-x", "-t", "jpg", url.path]
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus
    }.value
    if code != 0 { throw CaptureError.cancelled }
    return try jpeg(from: url)
  }

  static func jpeg(from url: URL) throws -> Data {
    let raw = try Data(contentsOf: url)
    guard !raw.isEmpty else { throw CaptureError.failed("That screenshot was empty.") }
    guard let image = NSImage(data: raw),
          let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let cg = rep.cgImage
    else {
      throw CaptureError.failed("Could not read that screenshot.")
    }
    guard let data = jpegData(downscale(cg, maxEdge: 1280), quality: 0.62) else {
      throw CaptureError.failed("Could not encode that screenshot.")
    }
    return data
  }

  static func openScreenRecordingSettings() {
    let urls = [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    ]
    for raw in urls {
      if let url = URL(string: raw), NSWorkspace.shared.open(url) { return }
    }
  }

  private static func ensurePermission() throws {
    if CGPreflightScreenCaptureAccess() { return }
    _ = CGRequestScreenCaptureAccess()
    if !CGPreflightScreenCaptureAccess() { throw CaptureError.permission }
  }

  private static func display(for point: CGPoint, in content: SCShareableContent) -> SCDisplay? {
    let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
    guard let screen else { return content.displays.first }
    return content.displays.min { lhs, rhs in
      distance(lhs, screen) < distance(rhs, screen)
    }
  }

  private static func distance(_ display: SCDisplay, _ screen: NSScreen) -> CGFloat {
    let width = abs(display.frame.width - screen.frame.width)
    let height = abs(display.frame.height - screen.frame.height)
    let originX = abs(display.frame.origin.x - screen.frame.origin.x)
    let originY = abs(display.frame.origin.y - screen.frame.origin.y)
    let flippedY = abs(display.frame.origin.y - (screen.frame.maxY - display.frame.height))
    return width + height + originX + min(originY, flippedY)
  }

  private static func downscale(_ image: CGImage, maxEdge: Int) -> CGImage {
    let edge = max(image.width, image.height)
    guard edge > maxEdge, edge > 0 else { return image }
    let scale = Double(maxEdge) / Double(edge)
    let width = max(1, Int((Double(image.width) * scale).rounded()))
    let height = max(1, Int((Double(image.height) * scale).rounded()))
    guard let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else {
      return image
    }
    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage() ?? image
  }

  private static func jpegData(_ image: CGImage, quality: CGFloat) -> Data? {
    NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: quality])
  }
}
