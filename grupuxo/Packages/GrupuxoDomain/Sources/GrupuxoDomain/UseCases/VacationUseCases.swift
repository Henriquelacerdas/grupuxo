import Foundation

public struct GetVacationUseCase: Sendable {
    public let repository: any HouseRepository

    public init(repository: any HouseRepository) {
        self.repository = repository
    }

    public func callAsFunction(userID: User.ID, houseID: House.ID) async throws -> VacationStatus {
        try await repository.vacation(for: userID, in: houseID)
    }
}

/// Liga ou desliga o modo férias. A escala dos cômodos é replanejada pelo servidor a partir da próxima segunda.
public struct SetVacationUseCase: Sendable {
    public let repository: any HouseRepository

    public init(repository: any HouseRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        _ isOn: Bool, userID: User.ID, houseID: House.ID, date: Date = .now
    ) async throws -> VacationStatus {
        try await repository.setVacation(isOn, for: userID, in: houseID, at: date)
    }
}
