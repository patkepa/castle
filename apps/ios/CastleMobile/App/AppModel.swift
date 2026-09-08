import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    var selectedTab: AppTab = .home
    private(set) var state: LoadState = .idle
    private(set) var catalog: CastleCatalog = .empty
    private(set) var repository = ConnectedRepository.fixture

    private let libraryRepository: any LibraryRepository
    private var noteCache: [String: CastleNoteContent] = [:]

    init(repository: any LibraryRepository) {
        self.libraryRepository = repository
    }

    var pinnedNotes: [CastleNote] {
        catalog.notes.filter(\.pinned)
    }

    var recentlyModifiedNotes: [CastleNote] {
        Array(catalog.notes.sorted { $0.modifiedAt > $1.modifiedAt }.prefix(8))
    }

    func notes(in sectionID: String?) -> [CastleNote] {
        guard let sectionID else { return catalog.notes }
        return catalog.notes.filter { $0.section == sectionID }
    }

    func note(id: String) -> CastleNote? {
        catalog.notes.first { $0.id == id }
    }

    func search(_ query: String) -> [CastleNote] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return catalog.notes }
        return catalog.notes.filter { note in
            note.title.localizedStandardContains(needle)
                || note.excerpt.localizedStandardContains(needle)
                || note.tags.contains { $0.localizedStandardContains(needle) }
        }
    }

    func loadIfNeeded() async {
        guard state == .idle else { return }
        await reload()
    }

    func reload() async {
        state = .loading
        do {
            catalog = try await libraryRepository.loadCatalog()
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func content(for note: CastleNote) async throws -> CastleNoteContent {
        if let cached = noteCache[note.id] {
            return cached
        }
        let content = try await libraryRepository.loadNote(at: note.contentPath)
        noteCache[note.id] = content
        return content
    }
}
