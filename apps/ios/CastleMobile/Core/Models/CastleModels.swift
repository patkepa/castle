import Foundation

struct CastleCatalog: Codable, Equatable, Sendable {
    let contractVersion: UInt32
    let generatedAt: String
    let sections: [CastleSection]
    let notes: [CastleNote]

    static let empty = CastleCatalog(
        contractVersion: 0,
        generatedAt: "",
        sections: [],
        notes: []
    )
}
struct CastleSection: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let label: String
    let icon: String
    let count: Int
}

struct CastleNote: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let section: String
    let sectionLabel: String
    let relativePath: String
    let sourceFile: String
    let route: String
    let title: String
    let excerpt: String
    let preview: String?
    let tags: [String]
    let aliases: [String]
    let status: String
    let avatarUrl: String
    let createdAt: String?
    let modifiedAt: String
    let contentPath: String
    let wordCount: Int
    let readingMinutes: Int
    let pinned: Bool
}

struct CastleNoteContent: Codable, Equatable, Sendable {
    let id: String
    let content: String
}

struct ConnectedRepository: Equatable, Sendable {
    let owner: String
    let name: String
    let branch: String
    let isFixture: Bool

    static let fixture = ConnectedRepository(
        owner: "castle",
        name: "example-library",
        branch: "main",
        isFixture: true
    )
}
