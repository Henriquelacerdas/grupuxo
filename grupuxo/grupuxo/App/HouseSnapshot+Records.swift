import Foundation
import GrupuxoDomain

/// O Amplify entregou um registro que o Mock não consegue representar.
enum SnapshotError: LocalizedError, Equatable {
    case invalidID(String)

    var errorDescription: String? {
        switch self {
        case .invalidID: "Os dados da casa vieram num formato inesperado. Tente novamente."
        }
    }
}

extension HouseSnapshot {
    /// Converte os registros reais no retrato do Mock. Puro: falha fechado se algum id não for UUID,
    /// em vez de inventar um (um id novo a cada chamada recriaria o morador ou cômodo a cada sync).
    /// `UUID(uuidString:)` ignora maiúsculas, então o mesmo id em caixa diferente dá o mesmo UUID.
    static func make(
        house: HouseRecord,
        members: [MemberRecord],
        rooms: [RoomRecord],
        inviteCode: String?
    ) throws -> HouseSnapshot {
        HouseSnapshot(
            houseID: try uuid(house.id),
            houseName: house.name,
            inviteCode: inviteCode ?? "",
            residents: try members.map { .init(id: try residentID($0), name: $0.name) },
            rooms: try rooms.map { .init(id: try uuid($0.id), name: $0.name) }
        )
    }

    /// Morador com conta usa o `sub` do Cognito; sem conta, o id do registro.
    static func residentID(_ member: MemberRecord) throws -> UUID {
        try uuid(member.userId ?? member.id)
    }

    static func uuid(_ string: String) throws -> UUID {
        guard let id = UUID(uuidString: string) else { throw SnapshotError.invalidID(string) }
        return id
    }
}
