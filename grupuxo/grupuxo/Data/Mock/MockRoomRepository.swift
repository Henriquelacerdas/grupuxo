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

            guard let room = state.rooms.first(where: { $0.id == id }) else {
                throw DomainError.entityNotFound
            }

            return room
        }
    }

    func rooms(in houseID: House.ID) async throws -> [Room] {

        await store.read { state in
            state.rooms.filter { $0.houseID == houseID }
        }
    }

    func create(
        _ room: Room,
        memberships: [RoomMembership]
    ) async throws -> Room {

        try await store.update { state in

            // 1. Confirma que a casa existe.
            guard state.houses.contains(where: { $0.id == room.houseID }) else {
                throw DomainError.entityNotFound
            }

            // 2. Descobre quem realmente é morador dessa casa.
            let houseMemberIDs = Set(
                state.houseMemberships
                    .filter { $0.houseID == room.houseID }
                    .map(\.userID)
            )

            // 3. Um cômodo precisa ter pelo menos um participante.
            guard !memberships.isEmpty else {
                throw DomainError.invalidRoomParticipants
            }

            // 4. Todos os vínculos precisam:
            // - pertencer ao cômodo que estamos criando;
            // - apontar para usuários que realmente moram nessa casa.
            let membershipsAreValid = memberships.allSatisfy { membership in

                membership.roomID == room.id &&
                houseMemberIDs.contains(membership.userID)
            }

            guard membershipsAreValid else {
                throw DomainError.invalidRoomParticipants
            }

            // 5. Evita criar o mesmo cômodo duas vezes.
            if let existingRoom = state.rooms.first(where: { $0.id == room.id }) {
                return existingRoom
            }

            // 6. Salva o cômodo.
            state.rooms.append(room)

            // 7. Salva os participantes, evitando vínculos duplicados.
            for membership in memberships {

                let alreadyExists = state.roomMemberships.contains {
                    $0.roomID == membership.roomID &&
                    $0.userID == membership.userID
                }

                if !alreadyExists {
                    state.roomMemberships.append(membership)
                }
            }

            return room
        }
    }
}
