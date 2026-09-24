import Foundation

struct MockHouseRepository: HouseRepository {

    let store: MockStore
    var scheduling = TaskSchedulingService(calendar: Calendar(identifier: .gregorian))

    func addMember(name: String, to houseID: House.ID, requestedBy: User.ID, at date: Date) async throws -> User {
        try await store.update { state in
            let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { throw DomainError.invalidResidentName }
            guard state.houses.contains(where: { $0.id == houseID }),
                  state.houseMemberships.contains(where: { $0.houseID == houseID && $0.userID == requestedBy }) else {
                throw DomainError.taskUnavailable
            }
            let user = User(id: UUID(), name: name, email: nil)
            state.users.append(user)
            state.houseMemberships.append(HouseMembership(id: UUID(), houseID: houseID, userID: user.id))
            var schedule = state.schedule
            for room in state.rooms where room.houseID == houseID && room.visibility == .common {
                try scheduling.addMember(userID: user.id, roomID: room.id, at: date, replan: false, state: &schedule)
            }
            try scheduling.rebalance(houseID: houseID, boundary: scheduling.addingWeeks(1, to: scheduling.weekStart(date)), at: date, state: &schedule)
            state.schedule = schedule
            return user
        }
    }

    func removeMember(userID: User.ID, from houseID: House.ID, requestedBy: User.ID, at date: Date, confirmRoomDeletion: Bool = false) async throws {
        try await store.update { state in
            guard userID != requestedBy else { throw DomainError.cannotRemoveCurrentUser }
            guard state.houseMemberships.contains(where: { $0.houseID == houseID && $0.userID == requestedBy }),
                  let membership = state.houseMemberships.first(where: { $0.houseID == houseID && $0.userID == userID }) else {
                throw DomainError.taskUnavailable
            }
            let roomIDs = Set(state.rooms.filter { $0.houseID == houseID }.map(\.id))
            var schedule = state.schedule
            for roomID in roomIDs {
                try scheduling.removeMember(userID: userID, roomID: roomID, at: date, confirmDeletion: confirmRoomDeletion, houseChange: true, replan: false, state: &schedule)
            }
            schedule.houseMemberships.removeAll { $0.id == membership.id }
            schedule.absences.removeAll { $0.membershipID == membership.id }
            try scheduling.rebalance(houseID: houseID, boundary: scheduling.addingWeeks(1, to: scheduling.weekStart(date)), at: date, state: &schedule)
            state.schedule = schedule
        }
    }


    func house(id: House.ID) async throws -> House {

        try await store.read { state in

            guard let house = state.houses.first(where: { $0.id == id }) else {
                throw DomainError.entityNotFound
            }

            return house
        }
    }

    func houses(for userID: User.ID) async throws -> [House] {

        await store.read { state in

            let ids = Set(
                state.houseMemberships
                    .filter { $0.userID == userID }
                    .map(\.houseID)
            )

            return state.houses.filter {
                ids.contains($0.id)
            }
        }
    }

    func members(in houseID: House.ID) async throws -> [User] {
        try await store.read { state in
            guard state.houses.contains(where: { $0.id == houseID }) else { throw DomainError.entityNotFound }
            let ids = Set(state.houseMemberships.filter { $0.houseID == houseID }.map(\.userID))
            return state.users.filter { ids.contains($0.id) }.sorted { $0.name < $1.name }
        }
    }

    func memberIDs(in houseID: House.ID) async throws -> [User.ID] {

        try await store.read { state in

            guard state.houses.contains(where: { $0.id == houseID }) else {
                throw DomainError.entityNotFound
            }

            return state.houseMemberships
                .filter { $0.houseID == houseID }
                .map(\.userID)
        }
    }
}
