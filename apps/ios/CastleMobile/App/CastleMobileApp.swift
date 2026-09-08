import SwiftUI

@main
struct CastleMobileApp: App {
    @State private var model = AppModel(repository: BundledLibraryRepository())

    var body: some Scene {
        WindowGroup {
            AppView()
                .environment(model)
                .task {
                    await model.loadIfNeeded()
                }
        }
    }
}
