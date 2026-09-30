import Foundation

public struct AddHouseMemberUseCase: Sendable {
    public let repository: any HouseRepository

    public init(repository: any HouseRepository) {
        self.repository = repository
    }

    public func callAsFunction(name: String, houseID: House.ID, requestedBy: User.ID, date: Date = .now) async throws -> User {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw DomainError.invalidResidentName }
        return try await repository.addMember(name: name, to: houseID, requestedBy: requestedBy, at: date)
    }
}
