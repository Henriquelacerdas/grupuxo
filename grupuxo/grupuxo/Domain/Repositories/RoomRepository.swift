// TODO — Expandir este contrato para criar cômodo com seus participantes.
// A operação deve ser async throws e persistir os vínculos de forma atômica.
// As consultas atuais não recebem usuário: incluir contexto de quem consulta
// para aplicar acesso a privados também na busca por ID. Separar a listagem
// comum da gestão dos cômodos acessíveis no editor, conforme ARCHITECTURE.md.
// Atualizar MockRoomRepository e casos de uso ao mudar o contrato.

import Foundation

protocol RoomRepository: Sendable {

    func room(
        id: Room.ID,
        requesting userID: User.ID
    ) async throws -> Room

    func rooms(
        in houseID: House.ID,
        requesting userID: User.ID
    ) async throws -> [Room]

    func create(
        _ room: Room,
        memberships: [RoomMembership]
    ) async throws -> Room
}
