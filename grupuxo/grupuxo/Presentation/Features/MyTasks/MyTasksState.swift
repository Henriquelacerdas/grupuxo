import GrupuxoDomain

enum MyTasksState: Equatable {
    case idle
    case loading
    case content(MyTasksContent)
    case empty
    case failure(String)
}

/// Seções recolhíveis da tela, na ordem em que aparecem.
enum MyTasksSection: String, CaseIterable, Identifiable {
    case cycle
    case extras
    case sporadic

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cycle: "Seu ciclo"
        case .extras: "Tarefas extras"
        case .sporadic: "Tarefas únicas"
        }
    }
}

struct MyTasksContent: Equatable {

    /// Uma tarefa já com os textos que a linha mostra.
    struct Row: Equatable, Identifiable {
        let item: TaskItem
        /// Cômodo da tarefa; vazio dentro de "Seu ciclo", onde o cômodo é o cabeçalho do grupo.
        let roomName: String?
        /// Dia do prazo ("Hoje", "Terça"), destacado ao lado do cômodo.
        let dueDay: String?

        var id: TaskOccurrence.ID { item.id }
    }

    struct Cycle: Equatable, Identifiable {
        let id: Room.ID
        let roomName: String
        let color: RoomColor
        /// "Termina domingo · 2 de 5".
        let status: String
        let spokenStatus: String
        let rows: [Row]
    }

    let cycles: [Cycle]
    let extras: [Row]
    let sporadics: [Row]

    var allItems: [TaskItem] {
        (cycles.flatMap(\.rows) + extras + sporadics).map(\.item)
    }

    func item(_ occurrenceID: TaskOccurrence.ID) -> TaskItem? {
        allItems.first { $0.id == occurrenceID }
    }
}
