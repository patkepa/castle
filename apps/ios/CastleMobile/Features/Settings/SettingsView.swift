import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section("Repository") {
                    LabeledContent("Name", value: model.repository.name)
                    LabeledContent("Owner", value: model.repository.owner)
                    LabeledContent("Branch", value: model.repository.branch)
                    LabeledContent("Access", value: "Read only")
                }

                Section("Snapshot") {
                    LabeledContent(
                        "Contract",
                        value: model.catalog.contractVersion.formatted()
                    )
                    LabeledContent("Notes", value: model.catalog.notes.count.formatted())
                    LabeledContent("Sections", value: model.catalog.sections.count.formatted())
                }

                Section {
                    Button {
                        Task { await model.reload() }
                    } label: {
                        Label("Reload snapshot", systemImage: "arrow.clockwise")
                    }
                    .disabled(model.state == .loading)
                } footer: {
                    Text("The first implementation uses a bundled Castle repository snapshot. GitHub sign-in and repository selection will replace this demo source in the next slice.")
                }
            }
            .navigationTitle("Settings")
        }
    }
}
