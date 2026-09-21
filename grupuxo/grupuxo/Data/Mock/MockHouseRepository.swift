struct MockHouseRepository: HouseRepository {

    let store: MockStore

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
