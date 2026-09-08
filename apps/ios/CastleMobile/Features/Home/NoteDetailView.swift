import SwiftUI

struct NoteDetailView: View {
    @Environment(AppModel.self) private var model
    let noteID: String

    @State private var content: CastleNoteContent?
    @State private var failure: String?

    private var note: CastleNote? {
        model.note(id: noteID)
    }

    var body: some View {
        Group {
            if let note, let content {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(note.sectionLabel.uppercased())
                                .font(.caption.weight(.bold))
                                .foregroundStyle(CastleTheme.accent)
                            Text(note.title)
                                .font(.largeTitle.bold())
                            Label(
                                "\(note.wordCount) words · \(note.readingMinutes) min read",
                                systemImage: "text.word.spacing"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }

                        Divider()

                        Text(renderedMarkdown(content.content))
                            .font(.body)
                            .lineSpacing(5)
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: 720, alignment: .leading)
                    .padding()
                    .frame(maxWidth: .infinity)
                }
            } else if let failure {
                ContentUnavailableView {
                    Label("Couldn’t open note", systemImage: "doc.badge.ellipsis")
                } description: {
                    Text(failure)
                }
            } else if note == nil {
                ContentUnavailableView("Note not found", systemImage: "doc.questionmark")
            } else {
                ProgressView("Loading note…")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: noteID) {
            guard let note else { return }
            do {
                content = try await model.content(for: note)
            } catch {
                failure = error.localizedDescription
            }
        }
    }

    private func renderedMarkdown(_ markdown: String) -> AttributedString {
        (try? AttributedString(
            markdown: markdown,
            options: .init(interpretedSyntax: .full)
        )) ?? AttributedString(markdown)
    }
}
