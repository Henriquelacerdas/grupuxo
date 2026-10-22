import Foundation
import GrupuxoDomain

enum HouseManagementState: Equatable {
    case idle
    case loading
    case content(HouseManagementContent)
    case empty
    case failure(String)
}

struct HouseManagementContent: Equatable {
    let sporadic: SporadicSummary
    let rooms: [RoomRow]
}

/// Linhas do card de tarefas únicas: as primeiras tarefas e, se sobrar, um resumo "+N Outras".
struct SporadicSummary: Equatable {

    /// Máximo de linhas no card, contando a linha de resumo.
    static let maxVisibleRows = 3

    enum Row: Equatable, Identifiable {

        case task(id: TaskOccurrence.ID, name: String, icon: String, color: RoomColor)
        case overflow(count: Int)

        var id: String {
            switch self {
            case let .task(id, _, _, _): id.uuidString
            case .overflow: "overflow"
            }
        }
    }

    let rows: [Row]
    let totalCount: Int

    var isEmpty: Bool { totalCount == 0 }
}

struct RoomRow: Equatable, Identifiable {

    /// O morador participa do cômodo: vê responsáveis, prazo e progresso e abre o cômodo.
    struct Member: Equatable {
        /// Cômodo privado de que o morador participa: cadeado aberto.
        let isPrivate: Bool
        let responsibles: String?
        let deadline: String
        let progress: CycleProgress
    }

    enum Access: Equatable {
        case member(Member)
        /// Cômodo privado de que o morador não participa: cadeado fechado e pedido de entrada.
        case restricted(requestPending: Bool)
    }

    let id: Room.ID
    let name: String
    let icon: String
    let color: RoomColor
    let access: Access
}
