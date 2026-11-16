import Foundation
import GrupuxoDomain

struct RoomDetailContent: Equatable {
    let room: Room
    let tasks: [TaskItem]
}

enum RoomDetailState: Equatable {
    case idle
    case loading
    case content(RoomDetailContent)
    case empty(Room)
    case failure(String)
}

/// Filtro do seletor "Agora / Todas" da tela do cômodo: "Agora" traz o que já está valendo no ciclo
/// (inclusive o já concluído) e o que ainda abre nesta semana ("Começa sábado"); "Todas" traz também
/// o agendado para datas posteriores.
enum RoomTaskFilter: Hashable, CaseIterable {
    case now
    case all

    var title: String {
        switch self {
        case .now: String(localized: "Agora")
        case .all: String(localized: "Todas")
        }
    }

    /// Se uma ocorrência que abre em `availableAt` aparece neste filtro. A semana começa na segunda.
    func includes(availableAt: Date, now: Date) -> Bool {
        switch self {
        case .all:
            return true
        case .now:
            if availableAt <= now { return true }
            var calendar = Calendar(identifier: .gregorian)
            calendar.firstWeekday = 2
            guard let weekEnd = calendar.dateInterval(of: .weekOfYear, for: now)?.end else { return false }
            return availableAt < weekEnd
        }
    }
}

/// As tarefas do cômodo agrupadas como na tela: ciclo (escala do cômodo), gerais (recorrentes
/// fora da escala) e únicas (avulsas). Só agrupa e filtra; a distribuição continua no domínio.
struct RoomDetailSections: Equatable {

    let cycle: [TaskItem]
    let general: [TaskItem]
    let single: [TaskItem]

    var isEmpty: Bool {
        cycle.isEmpty && general.isEmpty && single.isEmpty
    }

    init(content: RoomDetailContent, filter: RoomTaskFilter, now: Date) {

        let visible = content.tasks.filter { item in
            filter.includes(availableAt: item.occurrence.availableAt, now: now)
        }

        cycle = visible.filter {
            $0.definition.kind == .recurring && $0.definition.isLinked(to: content.room)
        }

        general = visible.filter {
            $0.definition.kind == .recurring && !$0.definition.isLinked(to: content.room)
        }

        single = visible.filter { $0.definition.kind == .sporadic }
    }
}
