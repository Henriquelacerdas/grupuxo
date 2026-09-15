// GUIA — Criar cômodos comuns e privados.
// Manter houseID obrigatório e IDs estáveis. Casa toda usa kind = .wholeHouse;
// cômodos cadastrados pelo usuário usam .standard. Privacidade pertence a
// visibility; a rotação semanal é configurada separadamente em rotationPolicy.
// TODO: criar CreateRoomUseCase para validar nome não vazio, casa e participantes,
// e salvar Room + RoomMembership juntos. As permissões de edição e aprovação
// ainda são decisões abertas em DESCRICAO.md; não presumir regras de administrador.

import Foundation

struct Room: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let houseID: House.ID
    var name: String
    var kind: RoomKind
    var visibility: RoomVisibility
    var rotationPolicy: RoomRotationPolicy

    nonisolated var representsWholeHouse: Bool { kind == .wholeHouse }
}
