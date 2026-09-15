// TODO — Receber o usuário solicitante e coordenar consultas com acesso a privados.
// Gerenciar casa exibe comuns e Casa toda; o editor precisa dos cômodos em que o
// usuário pode cadastrar tarefas, incluindo privados autorizados. Explicitar essa
// diferença nos casos de uso/contratos, sem espalhar filtros nas Views.

struct GetHouseRoomsUseCase: Sendable {
    let repository: any RoomRepository

    func callAsFunction(houseID: House.ID) async throws -> [Room] {
        try await repository.rooms(in: houseID)
    }
}
