import SwiftUI

struct RoomDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: RoomDetailViewModel
    @State private var selectedSuggestion: TaskSuggestion?
    private let makeSuggestionEditorViewModel: (TaskSuggestion) -> TaskEditorViewModel

    init(
        viewModel: RoomDetailViewModel,
        makeSuggestionEditorViewModel: @escaping (TaskSuggestion) -> TaskEditorViewModel
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.makeSuggestionEditorViewModel = makeSuggestionEditorViewModel
    }

    var body: some View {
        List {
            if let info = viewModel.participation {
                Section("Cômodo") {
                    HStack(spacing: DesignSystem.contentSpacing) {
                        RoomIconView(icon: info.room.icon, color: info.room.color, size: 40)
                        Text(info.room.name).font(.headline)
                    }
                    Text(info.room.periodicity.label)
                    Text(info.room.visibility == .common ? "Todos os moradores participam" : "Cômodo privado")
                    if info.isMember {
                        Text("Responsáveis: " + info.responsibleNames.joined(separator: ", "))
                        Text("\(info.periodStart.formatted(date: .abbreviated, time: .omitted)) até \(info.periodEnd.formatted(date: .abbreviated, time: .omitted))")
                        if !info.room.representsWholeHouse {
                            Button("Sair do cômodo", role: .destructive) {
                                Task { await viewModel.leave() }
                            }
                            .disabled(viewModel.isChangingMembership)
                        }
                    } else {
                        Text("Entre para consultar e criar tarefas neste cômodo.")
                        Button("Entrar no cômodo") { Task { await viewModel.join() } }
                            .disabled(viewModel.isChangingMembership)
                    }
                }
            }

            switch viewModel.state {
            case .idle, .loading:
                ProgressView("Carregando cômodo…")
            case let .content(content):
                Section(viewModel.participation?.isMember == true ? "Tarefas" : "Suas pendências preservadas") {
                    ForEach(content.tasks) { item in
                        TaskRow(item: item, canComplete: viewModel.canComplete(item)) {
                            Task { await viewModel.complete(item.id) }
                        }
                    }
                }
            case .empty:
                if viewModel.participation?.isMember == true && viewModel.suggestions.isEmpty {
                    Text("Nenhuma tarefa neste cômodo.")
                }
            case let .failure(message):
                Text(message)
            }

            if !viewModel.suggestions.isEmpty {
                Section {
                    ForEach(viewModel.suggestions) { suggestion in
                        Button { selectedSuggestion = suggestion } label: {
                            suggestionRow(suggestion)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Sugestões")
                } footer: {
                    Text("Toque em uma sugestão para editar e adicionar ao cômodo.")
                }
            }
        }
        .navigationTitle(viewModel.participation?.room.name ?? "Cômodo")
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
        .sheet(item: $selectedSuggestion, onDismiss: { Task { await viewModel.load() } }) { suggestion in
            TaskCreationSheetView(viewModel: makeSuggestionEditorViewModel(suggestion))
        }
        .onChange(of: viewModel.wasDeleted) { _, deleted in if deleted { dismiss() } }
        .alert("Sair e excluir cômodo?", isPresented: $viewModel.confirmsDeletion) {
            Button("Cancelar", role: .cancel) {}
            Button("Sair e excluir", role: .destructive) {
                Task { await viewModel.leave(confirmDeletion: true) }
            }
        } message: {
            Text("Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos.")
        }
        .alert("Não foi possível realizar a ação", isPresented: Binding(
            get: { viewModel.actionError != nil },
            set: { if !$0 { viewModel.actionError = nil } }
        )) {
            Button("OK") { viewModel.actionError = nil }
        } message: {
            Text(viewModel.actionError ?? "")
        }
    }

    private func suggestionRow(_ suggestion: TaskSuggestion) -> some View {
        HStack(spacing: DesignSystem.Spacing.medium) {
            Image(systemName: "sparkles").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                Text(suggestion.name).foregroundStyle(.primary)
                Text(effortName(suggestion.effort.points)).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(suggestion.effort.points)").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre o formulário para editar e adicionar esta tarefa.")
    }

    private func effortName(_ points: Int) -> String {
        switch points {
        case 1: "Fácil"
        case 2: "Médio"
        default: "Difícil"
        }
    }
}
