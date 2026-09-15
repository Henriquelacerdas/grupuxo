// TODO — Implementar criação de Room e RoomMembership no mesmo store.update,
// validando tudo antes de alterar o estado. Repetir a mesma criação por ID não
// deve duplicar cômodos ou vínculos. O mock deve permitir criar e consultar sem backend.
// ATENÇÃO: hoje as consultas filtram apenas ID/casa e não protegem cômodos privados.
// Ao receber o usuário no contrato, aplicar autorização antes de devolver dados;
// ocultar um item na View não protege a consulta direta por ID.

struct MockRoomRepository: RoomRepository {
    let store: MockStore

    func room(id: Room.ID) async throws -> Room {
        try await store.read { state in
            guard let room = state.rooms.first(where: { $0.id == id }) else { throw DomainError.entityNotFound }
            return room
        }
    }

    func rooms(in houseID: House.ID) async throws -> [Room] {
        await store.read { state in state.rooms.filter { $0.houseID == houseID } }
    }
}
