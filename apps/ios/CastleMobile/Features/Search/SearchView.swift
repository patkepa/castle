import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    private var results: [CastleNote] {
        model.search(query)
    }

    var body: some View {
        NavigationStack {
            List(results) { note in
                NavigationLink(value: AppRoute.note(note.id)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(note.title)
                            .font(.body.weight(.medium))
                        Text(note.excerpt)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        if !note.tags.isEmpty {
                            Text(note.tags.prefix(3).map { "#\($0)" }.joined(separator: "  "))
                                .font(.caption)
                                .foregroundStyle(CastleTheme.accent)
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Titles, notes, and tags")
            .overlay {
                if !query.isEmpty && results.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .navigationDestination(for: AppRoute.self) { route in
                switch route {
                case .note(let id): NoteDetailView(noteID: id)
                }
            }
        }
    }
}
