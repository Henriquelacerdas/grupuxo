// TODO — Implementar criação de Room e RoomMembership no mesmo store.update,
// validando tudo antes de alterar o estado. Repetir a mesma criação por ID não
// deve duplicar cômodos ou vínculos. O mock deve permitir criar e consultar sem backend.
// ATENÇÃO: hoje as consultas filtram apenas ID/casa e não protegem cômodos privados.
// Ao receber o usuário no contrato, aplicar autorização antes de devolver dados;
// ocultar um item na View não protege a consulta direta por ID.
struct MockRoomRepository: RoomRepository {

    let store: MockStore

    func room(
        id: Room.ID,
        requesting userID: User.ID
    ) async throws -> Room {

        try await store.read { state in

            guard let room = state.rooms.first(
                where: { $0.id == id }
            ) else {
                throw DomainError.entityNotFound
            }

            // Confirma que quem está consultando pertence à mesma casa.
            let isHouseMember = state.houseMemberships.contains {
                $0.houseID == room.houseID &&
                $0.userID == userID
            }

            guard isHouseMember else {
                throw DomainError.entityNotFound
            }

            // Cômodos privados só podem ser acessados por participantes.
            if room.visibility == .privateRoom {

                let isRoomMember = state.roomMemberships.contains {
                    $0.roomID == room.id &&
                    $0.userID == userID
                }

                guard isRoomMember else {
                    throw DomainError.entityNotFound
                }
            }

            return room
        }
    }

    func rooms(
        in houseID: House.ID,
        requesting userID: User.ID
    ) async throws -> [Room] {

        try await store.read { state in

            // Confirma que a casa existe.
            guard state.houses.contains(
                where: { $0.id == houseID }
            ) else {
                throw DomainError.entityNotFound
            }

            // Confirma que o usuário pertence à casa.
            let isHouseMember = state.houseMemberships.contains {
                $0.houseID == houseID &&
                $0.userID == userID
            }

            guard isHouseMember else {
                throw DomainError.entityNotFound
            }

            return state.rooms.filter { room in

                // Só queremos os cômodos desta casa.
                guard room.houseID == houseID else {
                    return false
                }

                // Cômodos comuns aparecem para todos os moradores da casa.
                if room.visibility == .common {
                    return true
                }

                // Cômodos privados aparecem somente para quem participa.
                return state.roomMemberships.contains {
                    $0.roomID == room.id &&
                    $0.userID == userID
                }
            }
        }
    }

    func create(
        _ room: Room,
        memberships: [RoomMembership]
    ) async throws -> Room {

        try await store.update { state in

            // 1. Confirma que a casa existe.
            guard state.houses.contains(
                where: { $0.id == room.houseID }
            ) else {
                throw DomainError.entityNotFound
            }

            // 2. Descobre quem realmente é morador dessa casa.
            let houseMemberIDs = Set(
                state.houseMemberships
                    .filter {
                        $0.houseID == room.houseID
                    }
                    .map(\.userID)
            )

            // 3. Um cômodo precisa ter pelo menos um participante.
            guard !memberships.isEmpty else {
                throw DomainError.invalidRoomParticipants
            }

            // 4. Todos os participantes precisam:
            // - estar vinculados ao cômodo criado;
            // - realmente morar naquela casa.
            let membershipsAreValid = memberships.allSatisfy { membership in

                membership.roomID == room.id &&
                houseMemberIDs.contains(
                    membership.userID
                )
            }

            guard membershipsAreValid else {
                throw DomainError.invalidRoomParticipants
            }

            // 5. Evita criar novamente um cômodo com o mesmo ID.
            if let existingRoom = state.rooms.first(
                where: { $0.id == room.id }
            ) {
                return existingRoom
            }

            // 6. Salva o cômodo.
            state.rooms.append(room)

            // 7. Salva os participantes,
            // evitando RoomMembership duplicado.
            for membership in memberships {

                let alreadyExists = state.roomMemberships.contains {
                    $0.roomID == membership.roomID &&
                    $0.userID == membership.userID
                }

                if !alreadyExists {
                    state.roomMemberships.append(
                        membership
                    )
                }
            }

            return room
        }
    }
}
