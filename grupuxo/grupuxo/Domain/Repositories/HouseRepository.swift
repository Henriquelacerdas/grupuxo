import Foundation

protocol HouseRepository: Sendable {

    func house(id: House.ID) async throws -> House

    func houses(for userID: User.ID) async throws -> [House]

    func members(in houseID: House.ID) async throws -> [User]

    func memberIDs(in houseID: House.ID) async throws -> [User.ID]
}
