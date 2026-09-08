import SwiftUI

struct BrowseView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedSectionID: String?

    private var notes: [CastleNote] {
        model.notes(in: selectedSectionID)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Section", selection: $selectedSectionID) {
                        Text("All notes").tag(String?.none)
                        ForEach(model.catalog.sections) { section in
                            Text("\(section.label) (\(section.count))")
                                .tag(Optional(section.id))
                        }
                    }
                }

                Section("\(notes.count) notes") {
                    ForEach(notes) { note in
                        NavigationLink(value: AppRoute.note(note.id)) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(note.title)
                                    .font(.body.weight(.medium))
                                Text(note.excerpt)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
            }
            .navigationTitle("Browse")
            .overlay {
                if model.state == .loaded && notes.isEmpty {
                    ContentUnavailableView(
                        "No notes",
                        systemImage: "doc",
                        description: Text("This section is empty.")
                    )
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
