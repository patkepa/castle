import XCTest
@testable import CastleMobile

final class AppModelTests: XCTestCase {
    @MainActor
    func testLoadingAndSearchingFixtureData() async {
        let note = CastleNote(
            id: "welcome",
            section: "notes",
            sectionLabel: "Notes",
            relativePath: "welcome.md",
            sourceFile: "notes/welcome.md",
            route: "/notes/welcome",
            title: "Welcome to Castle",
            excerpt: "A calm place for connected knowledge.",
            preview: nil,
            tags: ["guide"],
            aliases: [],
            status: "",
            avatarUrl: "",
            createdAt: nil,
            modifiedAt: "2026-09-08T00:00:00Z",
            contentPath: "/generated/notes/welcome.json",
            wordCount: 7,
            readingMinutes: 1,
            pinned: true
        )
        let catalog = CastleCatalog(
            contractVersion: 1,
            generatedAt: "2026-09-08T00:00:00Z",
            sections: [CastleSection(id: "notes", label: "Notes", icon: "note", count: 1)],
            notes: [note]
        )
        let model = AppModel(repository: StubRepository(catalog: catalog))

        await model.loadIfNeeded()

        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.search("castle").map(\.id), ["welcome"])
        XCTAssertEqual(model.search("guide").map(\.id), ["welcome"])
        XCTAssertTrue(model.search("missing").isEmpty)
        XCTAssertEqual(model.pinnedNotes.map(\.id), ["welcome"])
    }
}

private struct StubRepository: LibraryRepository {
    let catalog: CastleCatalog

    func loadCatalog() async throws -> CastleCatalog {
        catalog
    }

    func loadNote(at contentPath: String) async throws -> CastleNoteContent {
        CastleNoteContent(id: "welcome", content: "# Welcome")
    }
}
