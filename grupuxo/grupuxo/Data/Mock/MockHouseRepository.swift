struct MockHouseRepository: HouseRepository {
    let store: MockStore

    func house(id: House.ID) async throws -> House {
        try await store.read { state in
            guard let house = state.houses.first(where: { $0.id == id }) else { throw DomainError.entityNotFound }
            return house
        }
    }

    func houses(for userID: User.ID) async throws -> [House] {
        await store.read { state in
            let ids = Set(state.houseMemberships.filter { $0.userID == userID }.map(\.houseID))
            return state.houses.filter { ids.contains($0.id) }
        }
    }
}
