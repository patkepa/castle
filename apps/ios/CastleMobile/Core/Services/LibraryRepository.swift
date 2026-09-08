import Foundation

protocol LibraryRepository: Sendable {
    func loadCatalog() async throws -> CastleCatalog
    func loadNote(at contentPath: String) async throws -> CastleNoteContent
}
enum LibraryRepositoryError: LocalizedError {
    case missingResource(String)
    case invalidResourcePath(String)

    var errorDescription: String? {
        switch self {
        case .missingResource(let path):
            "The bundled Castle resource is missing: \(path)"
        case .invalidResourcePath(let path):
            "Castle rejected an unsafe resource path: \(path)"
        }
    }
}

struct BundledLibraryRepository: LibraryRepository {
    private let fixtureRoot: URL

    init(bundle: Bundle = .main) {
        fixtureRoot = bundle.resourceURL?.appending(path: "Fixture", directoryHint: .isDirectory)
            ?? URL(fileURLWithPath: "/missing-castle-fixture")
    }

    func loadCatalog() async throws -> CastleCatalog {
        try await decode(CastleCatalog.self, relativePath: "generated/catalog.json")
    }

    func loadNote(at contentPath: String) async throws -> CastleNoteContent {
        try await decode(CastleNoteContent.self, relativePath: normalized(contentPath))
    }

    private func decode<Value: Decodable & Sendable>(
        _ type: Value.Type,
        relativePath: String
    ) async throws -> Value {
        let root = fixtureRoot
        return try await Task.detached(priority: .userInitiated) {
            let url = root.appending(path: relativePath)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw LibraryRepositoryError.missingResource(relativePath)
            }
            return try JSONDecoder().decode(type, from: Data(contentsOf: url))
        }.value
    }

    private func normalized(_ path: String) throws -> String {
        let relative = path.drop(while: { $0 == "/" })
        guard !relative.isEmpty,
              !relative.split(separator: "/").contains("..") else {
            throw LibraryRepositoryError.invalidResourcePath(path)
        }
        return String(relative)
    }
}
