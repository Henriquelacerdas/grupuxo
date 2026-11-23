import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct WeekRatingViewModelTests {

    private struct FakeRatings: RatingRepository {
        let pendingItems: [PendingRating]

        func pending(in houseID: House.ID, for userID: User.ID) async throws -> [PendingRating] { pendingItems }
        func rate(_ choice: RoomRatingChoice, by userID: User.ID) async throws {}
        func summary(in houseID: House.ID, for userID: User.ID) async throws -> WeekSummary { .empty }
    }

    private func viewModel(pending: [PendingRating]) -> WeekRatingViewModel {
        let repository = FakeRatings(pendingItems: pending)
        return WeekRatingViewModel(
            getPending: GetPendingRatingsUseCase(repository: repository),
            rate: RateRoomsUseCase(repository: repository),
            getSummary: GetRatingSummaryUseCase(repository: repository),
            userID: UUID(), houseID: UUID()
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
}
