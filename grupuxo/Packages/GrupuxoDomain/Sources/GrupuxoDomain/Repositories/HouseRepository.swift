import Foundation

public protocol HouseRepository: Sendable {

    func addMember(name: String, to houseID: House.ID, requestedBy: User.ID, at date: Date) async throws -> User

    func removeMember(userID: User.ID, from houseID: House.ID, requestedBy: User.ID, at date: Date, confirmRoomDeletion: Bool) async throws

    func house(id: House.ID) async throws -> House

    func houses(for userID: User.ID) async throws -> [House]

    func members(in houseID: House.ID) async throws -> [User]

    func memberIDs(in houseID: House.ID) async throws -> [User.ID]

    /// Modo férias do morador (ausência sem data de volta).
    func vacation(for userID: User.ID, in houseID: House.ID) async throws -> VacationStatus

    /// Liga (a partir da próxima segunda) ou desliga o modo férias; idempotente.
    func setVacation(_ isOn: Bool, for userID: User.ID, in houseID: House.ID, at date: Date) async throws -> VacationStatus
}
