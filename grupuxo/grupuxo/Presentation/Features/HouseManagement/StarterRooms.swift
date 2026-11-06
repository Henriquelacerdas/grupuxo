import Foundation
import GrupuxoDomain

/// Cômodos sugeridos no passo "Primeiros cômodos" do onboarding (docs/DESIGN.md). Cada um nasce comum, com o ciclo
/// semanal padrão, e leva as primeiras tarefas sugeridas do catálogo (`TaskSuggestionCatalog`), que seguem o cômodo.
struct StarterRoom: Identifiable, Hashable {

    let id: String
    let category: RoomCategory
    let icon: String
    let color: RoomColor

    /// Nome no idioma do aparelho (o morador pode mudar depois).
    var name: String {
        switch category {
        case .kitchen: String(localized: "Cozinha")
        case .bathroom: String(localized: "Banheiro")
        case .livingRoom: String(localized: "Sala")
        case .bedroom: String(localized: "Quarto")
        case .laundry: String(localized: "Lavanderia")
        case .outdoor: String(localized: "Área externa")
        case .office: String(localized: "Escritório")
        case .other: String(localized: "Outro")
        }
    }

    /// Quantas tarefas sugeridas entram em cada cômodo: poucas, para a casa não nascer sobrecarregada.
    static let suggestedTasksPerRoom = 2

    static let all: [StarterRoom] = [
        StarterRoom(id: "kitchen", category: .kitchen, icon: "fork.knife", color: .orange),
        StarterRoom(id: "bathroom", category: .bathroom, icon: "shower.fill", color: .cyan),
        StarterRoom(id: "livingRoom", category: .livingRoom, icon: "sofa.fill", color: .indigo),
        StarterRoom(id: "bedroom", category: .bedroom, icon: "bed.double.fill", color: .purple),
        StarterRoom(id: "laundry", category: .laundry, icon: "washer.fill", color: .teal),
        StarterRoom(id: "outdoor", category: .outdoor, icon: "tree.fill", color: .green),
    ]

    /// As primeiras tarefas sugeridas para esta categoria.
    func suggestedTasks(catalog: TaskSuggestionCatalog = TaskSuggestionCatalog()) -> [TaskSuggestion] {
        Array(catalog.suggestions(for: category).prefix(Self.suggestedTasksPerRoom))
    }
}
