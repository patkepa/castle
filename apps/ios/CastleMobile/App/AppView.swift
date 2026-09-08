import SwiftUI

struct AppView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        TabView(selection: $model.selectedTab) {
            HomeView()
                .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.systemImage) }
                .tag(AppTab.home)

            BrowseView()
                .tabItem { Label(AppTab.browse.title, systemImage: AppTab.browse.systemImage) }
                .tag(AppTab.browse)

            SearchView()
                .tabItem { Label(AppTab.search.title, systemImage: AppTab.search.systemImage) }
                .tag(AppTab.search)

            SettingsView()
                .tabItem { Label(AppTab.settings.title, systemImage: AppTab.settings.systemImage) }
                .tag(AppTab.settings)
        }
        .tint(CastleTheme.accent)
    }
}
