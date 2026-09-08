import SwiftUI

enum AppTab: Hashable {
    case home
    case browse
    case search
    case settings

    var title: String {
        switch self {
        case .home: "Home"
        case .browse: "Browse"
        case .search: "Search"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .browse: "books.vertical"
        case .search: "magnifyingglass"
        case .settings: "gearshape"
        }
    }
}
enum AppRoute: Hashable {
    case note(String)
}
