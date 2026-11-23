import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct WeekRatingViewModelTests {

    private final class FakeRatings: RatingRepository, @unchecked Sendable {
        var pendingItems: [PendingRating]
        init(_ items: [PendingRating]) { pendingItems = items }

        func pending(in houseID: House.ID, for userID: User.ID) async throws -> [PendingRating] { pendingItems }
        func rate(_ choice: RoomRatingChoice, by userID: User.ID) async throws {}
        func summary(in houseID: House.ID, for userID: User.ID) async throws -> WeekSummary { .empty }
    }

    private func viewModel(
        pending: [PendingRating], defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!,
        repository: FakeRatings? = nil
    ) -> WeekRatingViewModel {
        let repository = repository ?? FakeRatings(pending)
        return WeekRatingViewModel(
            getPending: GetPendingRatingsUseCase(repository: repository),
            rate: RateRoomsUseCase(repository: repository),
            getSummary: GetRatingSummaryUseCase(repository: repository),
            getRooms: GetHouseRoomsUseCase(repository: AppContainer().roomRepository),
            userID: UUID(), houseID: UUID(), defaults: defaults
        )
    }

    @Test func startsEmptyAndShowsThePendingRoomsAfterLoading() async {
        let now = Date.now
        let room = PendingRating(
            roomID: UUID(), roomName: "Cozinha", periodStart: now.addingTimeInterval(-8 * 86_400),
            periodEnd: now.addingTimeInterval(-86_400), windowEnd: now.addingTimeInterval(86_400)
        )
        let model = viewModel(pending: [room])
        #expect(!model.hasPending, "a linha só existe depois de carregar: quem carrega precisa ser chamado de fora dela")
        await model.load()
        #expect(model.hasPending)
        #expect(model.closesAt == room.windowEnd)
    }

    @Test func loadingTwiceKeepsTheSameResult() async {
        let now = Date.now
        let room = PendingRating(
            roomID: UUID(), roomName: "Sala", periodStart: now.addingTimeInterval(-8 * 86_400),
            periodEnd: now.addingTimeInterval(-86_400), windowEnd: now.addingTimeInterval(86_400)
        )
        let model = viewModel(pending: [room])
        await model.load()
        await model.load()
        #expect(model.pending == [room])
    }

    @Test func afterSubmittingShowsTheSentStateUntilTheWindowCloses() async {
        let now = Date.now
        let room = PendingRating(
            roomID: UUID(), roomName: "Cozinha", periodStart: now.addingTimeInterval(-8 * 86_400),
            periodEnd: now.addingTimeInterval(-86_400), windowEnd: now.addingTimeInterval(86_400)
        )
        let repository = FakeRatings([room])
        let model = viewModel(pending: [], repository: repository)
        await model.load()
        model.select(.good, for: room.roomID)
        #expect(await model.submit())
        // O servidor deixa de listar a avaliação já enviada.
        repository.pendingItems = []
        await model.load()
        #expect(!model.hasPending)
        #expect(model.hasSubmitted)
        #expect(model.submittedUntil == room.windowEnd)
    }

    @Test func periodUsesDayAndAbbreviatedMonthWithoutDe() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Sao_Paulo")!
        let start = calendar.date(from: DateComponents(year: 2026, month: 10, day: 27))!
        let end = calendar.date(from: DateComponents(year: 2026, month: 11, day: 3))!
        let text = WeekRatingText.period(from: start, to: end, calendar: calendar)
        #expect(!text.contains(" de "))
        #expect(!text.contains("."))
        #expect(text.hasPrefix("27 "))
        #expect(text.contains("– 2 "))
    }
}
