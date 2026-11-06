import Foundation

public protocol RoomAccessRequestRepository: Sendable {

    /// Cômodos da casa para os quais o morador tem um pedido de entrada aberto.
    func pendingRoomIDs(in houseID: House.ID, requesting userID: User.ID) async throws -> Set<Room.ID>

    /// Idempotente: pedir de novo não cria outro pedido. Falha se o morador já participa do cômodo
    /// ou se o cômodo não é privado.
    func request(roomID: Room.ID, requesting userID: User.ID, at date: Date) async throws

    /// Idempotente: cancelar sem pedido aberto não faz nada.
    func cancel(roomID: Room.ID, requesting userID: User.ID) async throws

    /// Um participante do cômodo aprova (o morador entra no cômodo) ou recusa o pedido de `requesterID`.
    func answer(roomID: Room.ID, requesterID: User.ID, answeredBy userID: User.ID, approve: Bool, at date: Date) async throws
}
