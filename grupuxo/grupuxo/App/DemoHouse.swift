#if DEBUG
import Foundation
import GrupuxoDomain
import SwiftUI

/// Casa de demonstração sobre o `MockStore`, só em Debug: abre as abas sem login nem `api`,
/// para conferir as telas no simulador e nos testes de UI. Ativa com o argumento de lançamento `-DemoHouse`.
enum DemoHouse {

    static let launchArgument = "-DemoHouse"

    static let onboardingArgument = "-DemoOnboarding"

    /// Passo do onboarding a abrir (`-DemoOnboarding 3`; 0 = primeiro).
    static var onboardingStep: Int? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: onboardingArgument) else { return nil }
        return arguments.indices.contains(index + 1) ? Int(arguments[index + 1]) ?? 0 : 0
    }

    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains(launchArgument)
    }
}

/// Raiz do app na casa de demonstração: os mesmos `RootView` e use cases, com repositórios `Mock*`.
struct DemoHouseRootView: View {

    @StateObject private var model = RootModel(
        container: AppContainer(),
        session: AppSession(
            currentUser: MockSeed.currentUser,
            currentHouse: MockSeed.house
        )
    )

    var body: some View {
        RootView(model: model)
    }
}

/// Onboarding sem login nem `api`, para conferir os textos e o layout de cada passo.
struct DemoOnboardingRootView: View {
    let step: Int
    @State private var isFinishing = false
    @StateObject private var houses = RemoteHouseSession(api: nil)
    @StateObject private var authService = AuthService()
    @StateObject private var push = PushRegistration()

    @ViewBuilder
    private var screen: some View {
        switch step {
        case 100: WelcomeView(onContinue: {})
        case 101: NavigationStack { LoginView() }
        case 102: NavigationStack { SignUpView(email: .constant("")) }
        case 200: DemoRatingRoot(showsSummary: false)
        case 201: DemoRatingRoot(showsSummary: true)
        default: OnboardingView(isFinishing: $isFinishing, debugStep: step)
        }
    }

    var body: some View {
        screen
            .environmentObject(houses)
            .environmentObject(authService)
            .environmentObject(push)
    }
}

/// Avaliar a semana e Resumo com dados de mentira, para conferir as tags no simulador (`-DemoOnboarding 200` e `201`).
private struct DemoRatingRoot: View {
    let showsSummary: Bool
    @State private var viewModel: WeekRatingViewModel?

    private static let kitchen = MockSeed.rooms[0]
    private static let bathroom = MockSeed.rooms.count > 1 ? MockSeed.rooms[1] : MockSeed.rooms[0]

    var body: some View {
        Group {
            if let viewModel {
                if showsSummary {
                    WeekSummarySheet(summary: summary, currentUserID: MockSeed.currentUser.id, looks: looks)
                } else {
                    RateWeekSheet(viewModel: viewModel)
                }
            } else {
                ProgressView()
            }
        }
        .task {
            let model = WeekRatingViewModel(
                getPending: GetPendingRatingsUseCase(repository: DemoRatingRepository()),
                rate: RateRoomsUseCase(repository: DemoRatingRepository()),
                getSummary: GetRatingSummaryUseCase(repository: DemoRatingRepository()),
                getRooms: GetHouseRoomsUseCase(repository: MockRoomRepository(store: MockStore())),
                userID: MockSeed.currentUser.id, houseID: MockSeed.house.id
            )
            await model.load()
            viewModel = model
        }
    }

    private var looks: [Room.ID: WeekRatingViewModel.RoomLook] {
        Dictionary(uniqueKeysWithValues: MockSeed.rooms.map { ($0.id, .init(icon: $0.icon, color: $0.color)) })
    }

    private var summary: WeekSummary { DemoRatingRepository.summary }
}

private struct DemoRatingRepository: RatingRepository {
    static var summary: WeekSummary {
        let start = Date.now.addingTimeInterval(-6 * 86_400)
        let end = Date.now.addingTimeInterval(86_400)
        return WeekSummary(
            weekStart: start, weekEnd: end, tasksDone: 23, tasksTotal: 25,
            mine: [RoomWeekResult(
                roomID: MockSeed.rooms[0].id, roomName: MockSeed.rooms[0].name, periodStart: start, periodEnd: end,
                ratingCount: 3, level: .good, tags: [.spotless, .onTime, .halfDone],
                responsibleUserIDs: [MockSeed.currentUser.id], responsibleNames: [MockSeed.currentUser.name]
            )],
            house: [], upcomingRoomNames: []
        )
    }

    func pending(in houseID: House.ID, for userID: User.ID) async throws -> [PendingRating] {
        let start = Date.now.addingTimeInterval(-7 * 86_400)
        return MockSeed.rooms.prefix(2).map {
            PendingRating(roomID: $0.id, roomName: $0.name, periodStart: start, periodEnd: .now, windowEnd: .now.addingTimeInterval(2 * 86_400))
        }
    }

    func rate(_ choice: RoomRatingChoice, by userID: User.ID) async throws {}

    func summary(in houseID: House.ID, for userID: User.ID) async throws -> WeekSummary { Self.summary }
}
#endif
