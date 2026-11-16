import Foundation

/// Edita um cômodo (nome, aparência, periodicidade e responsáveis). "Casa toda" não se edita.
public struct UpdateRoomUseCase: Sendable {

    public let repository: any RoomRepository

    public init(repository: any RoomRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        roomID: Room.ID,
        patch: RoomPatch,
        userID: User.ID,
        date: Date = .now
    ) async throws -> Room {

        var patch = patch

        if let name = patch.name {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw DomainError.invalidRoomName }
            patch.name = trimmed
        }

        if let periodicity = patch.periodicity, !periodicity.isValid { throw DomainError.invalidSchedule }
        if let count = patch.responsibleCount, count <= 0 { throw DomainError.invalidSchedule }

        return try await repository.update(roomID: roomID, patch: patch, requestedBy: userID, at: date)
    }
}
