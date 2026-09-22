// GUIA — Participantes do cômodo são a base da elegibilidade na distribuição.
// Ao criar cômodo comum, incluir moradores da casa por padrão; permitir ajustar
// participantes. Um privado deve ter uma ou mais pessoas da mesma casa.
// TODO: validar vínculos e evitar duplicar o par roomID/userID. Alterações de
// participantes devem disparar nova distribuição das tarefas afetadas.

import Foundation

struct RoomMembership: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    let roomID: Room.ID
    let userID: User.ID

    // Saldo de Justiça (Fairness Debt) para o balanceamento matemático.
    // Positivo: Trabalhou mais que a média. Negativo: Trabalhou menos.
    var fairnessDebt: Double = 0.0
}
