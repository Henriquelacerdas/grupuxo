import Foundation
import GrupuxoDomain

/// Sem servidor não há avaliação da semana: nada a avaliar e nenhum resultado.
struct MockRatingRepository: RatingRepository {

    func pending(in houseID: House.ID, for userID: User.ID) async throws -> [PendingRating] { [] }

    func rate(_ choice: RoomRatingChoice, by userID: User.ID) async throws {}

    func summary(in houseID: House.ID, for userID: User.ID) async throws -> [RatingResult] { [] }
}
