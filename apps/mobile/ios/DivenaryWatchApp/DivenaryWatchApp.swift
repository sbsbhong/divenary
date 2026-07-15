import SwiftUI

@main
struct DivenaryWatchApp: App {
    @StateObject private var sessionStore = DiveSessionStore()

    var body: some Scene {
        WindowGroup {
            HomeView(store: sessionStore)
        }
    }
}
