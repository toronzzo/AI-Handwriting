import AVFoundation
import Foundation
import Speech

/// On-device speech for the question field. If this Mac cannot recognize
/// speech locally, we stop and say so. Audio is not sent to the brain.
@MainActor
final class SpeechInput {
  private let recognizer = SFSpeechRecognizer()
  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var tapped = false
  private var base = ""
  private(set) var listening = false

  func toggle(currentText: String, onText: @escaping @MainActor (String) -> Void, onError: @escaping @MainActor (String) -> Void) {
    if listening {
      stop()
      return
    }
    Task { @MainActor in
      do {
        try await self.start(currentText: currentText, onText: onText, onError: onError)
      } catch {
        onError(error.localizedDescription)
      }
    }
  }

  func stop() {
    listening = false
    task?.cancel()
    task = nil
    request?.endAudio()
    request = nil
    engine.stop()
    if tapped {
      engine.inputNode.removeTap(onBus: 0)
      tapped = false
    }
  }

  private func start(currentText: String, onText: @escaping @MainActor (String) -> Void, onError: @escaping @MainActor (String) -> Void) async throws {
    guard let recognizer, recognizer.isAvailable else {
      throw SpeechFailure("Speech recognition is not available. Type the question. Audio was not sent anywhere.")
    }
    guard recognizer.supportsOnDeviceRecognition else {
      throw SpeechFailure("On-device speech isn't available for this language. Type the question. Audio was not sent anywhere.")
    }
    let speech = await Self.speechAllowed()
    guard speech else {
      throw SpeechFailure("Speech recognition is off. Turn it on for Preyas Helper in System Settings, or type the question.")
    }
    let mic = await Self.microphoneAllowed()
    guard mic else {
      throw SpeechFailure("The microphone is off. Turn it on for Preyas Helper in System Settings, or type the question.")
    }

    stop()
    base = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
    let recognition = SFSpeechAudioBufferRecognitionRequest()
    recognition.shouldReportPartialResults = true
    recognition.requiresOnDeviceRecognition = true
    request = recognition
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.channelCount > 0, format.sampleRate > 0 else {
      throw SpeechFailure("The microphone did not start. Check Microphone permission for Preyas Helper.")
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      recognition.append(buffer)
    }
    tapped = true
    engine.prepare()
    try engine.start()
    listening = true
    task = recognizer.recognitionTask(with: recognition) { [weak self] result, error in
      Task { @MainActor in
        guard let self, self.listening else { return }
        if let result {
          let spoken = result.bestTranscription.formattedString
          let prefix = self.base
          onText(prefix.isEmpty ? spoken : "\(prefix) \(spoken)")
        }
        if error != nil, result == nil {
          onError("Speech recognition stopped. Type the question. Audio stayed on this Mac.")
          self.stop()
          return
        }
        if result?.isFinal == true {
          self.stop()
        }
      }
    }
  }

  private static func speechAllowed() async -> Bool {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status == .authorized)
      }
    }
  }

  private static func microphoneAllowed() async -> Bool {
    await withCheckedContinuation { continuation in
      AVCaptureDevice.requestAccess(for: .audio) { granted in
        continuation.resume(returning: granted)
      }
    }
  }
}

private struct SpeechFailure: LocalizedError {
  var message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
