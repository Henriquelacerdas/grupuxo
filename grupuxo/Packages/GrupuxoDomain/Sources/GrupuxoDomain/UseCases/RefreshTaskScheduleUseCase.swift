import Foundation

public struct RefreshTaskScheduleUseCase: Sendable {
    public let repository: any TaskRepository

    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(houseID: House.ID, date: Date = .now) async throws {
        try await repository.refreshSchedule(in: houseID, at: date)
    }
}
