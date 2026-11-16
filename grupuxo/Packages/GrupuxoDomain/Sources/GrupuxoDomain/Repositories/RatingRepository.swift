import Foundation

/// Avaliar a semana e Resumo da semana (BACKEND.md §6.1).
public protocol RatingRepository: Sendable {

    /// Cômodos que o morador pode avaliar agora (ciclo acabou há menos de 2 dias, não cuidou, ainda não avaliou).
    func pending(in houseID: House.ID, for userID: User.ID) async throws -> [PendingRating]

    /// Grava ou refaz a avaliação; fecha a janela depois de 2 dias.
    func rate(_ choice: RoomRatingChoice, by userID: User.ID) async throws

    /// Resumo da semana: período, tarefas feitas e os resultados liberados (os cômodos do morador e os da casa).
    func summary(in houseID: House.ID, for userID: User.ID) async throws -> WeekSummary
}
