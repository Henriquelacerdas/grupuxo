// TODO — Adicionar rota do formulário de cômodo e conectá-la em RootView.
// Transportar somente IDs quando houver edição. Criação de cômodos e tarefas
// parte de Gerenciar casa; Minhas tarefas continua dedicada às atribuições.
// No detalhe do cômodo, a manutenção de tarefas pode reutilizar TaskEditor.

enum AppRoute: Hashable {
    case roomDetail(Room.ID)
    case sporadicTasks
    case taskEditor(roomID: Room.ID?)
    case taskSwap(offeredOccurrenceID: TaskOccurrence.ID)
    case notifications
    case settings
}

enum AppTab: Hashable {
    case myTasks
    case house
}
