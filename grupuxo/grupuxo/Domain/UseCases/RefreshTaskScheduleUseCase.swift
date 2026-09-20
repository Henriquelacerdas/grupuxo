import Foundation

struct RefreshTaskScheduleUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(houseID: House.ID, date: Date = .now) async throws {
        try await repository.refreshSchedule(in: houseID, at: date)
    }
}
