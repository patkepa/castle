import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                switch model.state {
                case .idle, .loading:
                    ProgressView("Opening your library…")
                case .failed(let message):
                    ContentUnavailableView {
                        Label("Library unavailable", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") {
                            Task { await model.reload() }
                        }
                    }
                case .loaded:
                    libraryHome
                }
            }
            .navigationTitle("Castle")
            .navigationDestination(for: AppRoute.self) { route in
                switch route {
                case .note(let id):
                    NoteDetailView(noteID: id)
                }
            }
        }
    }

    private var libraryHome: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                RepositoryCard(repository: model.repository)

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 145), spacing: 12)],
                    spacing: 12
                ) {
                    MetricCard(
                        label: "Notes",
                        value: model.catalog.notes.count,
                        systemImage: "doc.text"
                    )
                    MetricCard(
                        label: "Sections",
                        value: model.catalog.sections.count,
                        systemImage: "square.grid.2x2"
                    )
                }

                if !model.pinnedNotes.isEmpty {
                    NoteCollection(
                        title: "Pinned",
                        systemImage: "pin.fill",
                        notes: model.pinnedNotes
                    )
                }

                NoteCollection(
                    title: "Recently updated",
                    systemImage: "clock",
                    notes: model.recentlyModifiedNotes
                )
            }
            .padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .refreshable { await model.reload() }
    }
}
private struct RepositoryCard: View {
    let repository: ConnectedRepository

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "shippingbox.fill")
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(CastleTheme.accent.gradient, in: RoundedRectangle(cornerRadius: 13))

            VStack(alignment: .leading, spacing: 3) {
                Text(repository.name)
                    .font(.headline)
                Text("\(repository.owner) · \(repository.branch)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(repository.isFixture ? "Demo" : "Read only")
                .font(.caption.weight(.semibold))
                .foregroundStyle(CastleTheme.accent)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(CastleTheme.accent.opacity(0.12), in: Capsule())
        }
        .padding(16)
        .background(CastleTheme.cardBackground, in: RoundedRectangle(cornerRadius: 20))
    }
}

private struct MetricCard: View {
    let label: String
    let value: Int
    let systemImage: String

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(value, format: .number)
                    .font(.title.bold())
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(CastleTheme.secondaryAccent)
        }
        .padding(16)
        .background(CastleTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct NoteCollection: View {
    let title: String
    let systemImage: String
    let notes: [CastleNote]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage)
                .font(.title3.bold())

            ForEach(notes) { note in
                NavigationLink(value: AppRoute.note(note.id)) {
                    NoteRow(note: note)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct NoteRow: View {
    let note: CastleNote

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(CastleTheme.accent)
                .frame(width: 34, height: 34)
                .background(CastleTheme.accent.opacity(0.11), in: RoundedRectangle(cornerRadius: 9))

            VStack(alignment: .leading, spacing: 4) {
                Text(note.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text(note.excerpt)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text("\(note.sectionLabel) · \(note.readingMinutes) min")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .padding(.top, 8)
        }
        .padding(14)
        .background(CastleTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
    }

    private var icon: String {
        switch note.section {
        case "people": "person.fill"
        case "projects": "folder.fill"
        case "journal": "book.closed.fill"
        case "tasks": "checkmark.circle.fill"
        case "events": "calendar"
        default: "doc.text.fill"
        }
    }
}
