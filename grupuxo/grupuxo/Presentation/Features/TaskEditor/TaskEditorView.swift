// GUIA — O Stepper já permite escolher esforço manualmente de 1 a 3.
// TODO: adicionar controles de recorrência, hoje ausentes, e apresentar somente
// políticas compatíveis com o tipo escolhido. Avulsa não tem recorrência e será
// assumida no card de esporádicas. Manter cômodo obrigatório nos dois tipos.
// Após .saved, fechar/retornar pelo fluxo de navegação e atualizar as consultas.
// A View edita o rascunho; regras de cadastro e distribuição ficam no domínio.

import SwiftUI

struct TaskEditorView: View {
    @StateObject private var viewModel: TaskEditorViewModel

    init(viewModel: TaskEditorViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        Form {
            TextField("Nome", text: binding(\.name))
            TextField("Descrição", text: binding(\.details), axis: .vertical)
            Picker("Cômodo", selection: binding(\.roomID)) {
                Text("Selecione").tag(Room.ID?.none)
                ForEach(viewModel.rooms) { Text($0.name).tag(Optional($0.id)) }
            }
            Stepper("Esforço: \(viewModel.state.draft.effortPoints)", value: binding(\.effortPoints), in: 1...3)
            Picker("Tipo", selection: binding(\.kind)) {
                Text("Recorrente").tag(TaskKind.recurring)
                Text("Esporádica").tag(TaskKind.sporadic)
            }
            Picker("Visibilidade", selection: binding(\.visibility)) {
                Text("Casa").tag(TaskVisibility.house)
                Text("Privada").tag(TaskVisibility.privateTask)
            }
            Picker("Distribuição", selection: binding(\.assignmentPolicy)) {
                Text("Equilibrar automaticamente").tag(TaskAssignmentPolicy.balancedAutomatically)
                Text("Rotação por calendário").tag(TaskAssignmentPolicy.calendarRotation)
                Text("Após conclusão").tag(TaskAssignmentPolicy.afterCompletion)
                Text("Assumida por um morador").tag(TaskAssignmentPolicy.selfAssigned)
            }
            if case let .failure(_, message) = viewModel.state {
                Text(message).foregroundStyle(.red)
            }
            Button("Salvar") { Task { await viewModel.save() } }
                .disabled(isSaving)
        }
        .navigationTitle("Nova tarefa")
        .task { await viewModel.loadRooms() }
    }

    private var isSaving: Bool {
        if case .saving = viewModel.state { true } else { false }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<TaskDraft, Value>) -> Binding<Value> {
        Binding(
            get: { viewModel.state.draft[keyPath: keyPath] },
            set: { value in viewModel.updateDraft { $0[keyPath: keyPath] = value } }
        )
    }
}
