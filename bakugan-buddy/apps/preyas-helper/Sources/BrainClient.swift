import Foundation

struct HistoryTurn: Codable, Sendable {
  var role: String
  var content: String
}

struct VisionPayload: Decodable, Sendable {
  var answer: String?
  var route: String?
  var model: String?
  var leavesMac: Bool?
  var notice: String?
  var message: String?
  var error: String?
  var fellBack: Bool?
  var localReady: Bool?
  var ok: Bool?
}

enum BrainError: LocalizedError {
  case noToken
  case blockedHost
  case transport(String)
  case server(String)

  var errorDescription: String? {
    switch self {
    case .noToken:
      return BrainClient.missingTokenMessage
    case .blockedHost:
      return "The brain address must be this Mac or your home network. Pictures are not sent to a public host."
    case .transport(let message):
      return "The brain on port 8788 did not answer. \(message)"
    case .server(let message):
      return message
    }
  }
}

struct BrainClient: Sendable {
  var baseURL: URL
  var token: String

  static let missingTokenMessage =
    "Pair this Mac once in the Preyas web app. The helper reads the token from /Volumes/Agent/BakuganBuddy/memory/local-token (or PREYAS_TOKEN_PATH). The token is sent as X-Preyas-Token and is not printed."

  static func load() -> Result<BrainClient, BrainError> {
    let env = ProcessInfo.processInfo.environment
    let raw = env["PREYAS_BRAIN_URL"] ?? "http://127.0.0.1:8788"
    guard let url = URL(string: raw), let host = url.host, isAllowedHost(host), url.scheme == "http" || url.scheme == "https" else {
      return .failure(.blockedHost)
    }
    guard let token = readToken() else { return .failure(.noToken) }
    return .success(BrainClient(baseURL: url, token: token))
  }

  func status() async throws -> VisionPayload {
    var request = URLRequest(url: endpoint("v1/vision"))
    request.httpMethod = "GET"
    request.timeoutInterval = 8
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue(token, forHTTPHeaderField: "X-Preyas-Token")
    return try await send(request)
  }

  func ask(question: String, jpeg: Data, history: [HistoryTurn], prefer: String) async throws -> VisionPayload {
    var request = URLRequest(url: endpoint("v1/vision/ask"))
    request.httpMethod = "POST"
    request.timeoutInterval = 120
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue(token, forHTTPHeaderField: "X-Preyas-Token")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: Any] = [
      "question": question,
      "image": jpeg.base64EncodedString(),
      "mime": "image/jpeg",
      "history": history.map { ["role": $0.role, "content": $0.content] },
      "prefer": prefer,
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    return try await send(request)
  }

  /// One path segment at a time, so a slash is not encoded as %2F.
  private func endpoint(_ path: String) -> URL {
    var url = baseURL
    for part in path.split(separator: "/") where !part.isEmpty {
      url.appendPathComponent(String(part))
    }
    return url
  }

  private func send(_ request: URLRequest) async throws -> VisionPayload {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw BrainError.transport("Is Preyas running?")
    }
    let payload = (try? JSONDecoder().decode(VisionPayload.self, from: data)) ?? VisionPayload()
    let http = response as? HTTPURLResponse
    if let http, !(200..<300).contains(http.statusCode) {
      throw BrainError.server(payload.message ?? payload.notice ?? "The brain answered \(http.statusCode).")
    }
    if payload.error != nil, (payload.answer ?? "").isEmpty {
      throw BrainError.server(payload.message ?? payload.notice ?? "Preyas could not answer.")
    }
    return payload
  }

  static func readToken() -> String? {
    for path in tokenCandidates() {
      guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
      let token = text.trimmingCharacters(in: .whitespacesAndNewlines)
      if token.range(of: #"^[A-Za-z0-9_-]{16,128}$"#, options: .regularExpression) != nil {
        return token
      }
    }
    return nil
  }

  static func tokenCandidates() -> [String] {
    let env = ProcessInfo.processInfo.environment
    var paths: [String] = []
    if let path = env["PREYAS_TOKEN_PATH"], !path.isEmpty { paths.append(path) }
    if let data = env["BAKUGAN_DATA_DIR"], !data.isEmpty {
      paths.append((data as NSString).appendingPathComponent("memory/local-token"))
    }
    paths.append("/Volumes/Agent/BakuganBuddy/memory/local-token")
    return paths
  }

  static func isAllowedHost(_ host: String) -> Bool {
    let name = host.lowercased()
    if name == "localhost" || name == "127.0.0.1" || name == "::1" { return true }
    if name.hasPrefix("10.") || name.hasPrefix("192.168.") { return true }
    let parts = name.split(separator: ".")
    if parts.count == 4, parts[0] == "172", let second = Int(parts[1]), (16...31).contains(second) {
      return true
    }
    return false
  }
}
