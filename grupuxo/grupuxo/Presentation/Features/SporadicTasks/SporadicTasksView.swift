import SwiftUI

struct SporadicTasksView: View {
    @StateObject private var viewModel: SporadicTasksViewModel

    init(viewModel: SporadicTasksViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading: ProgressView("Carregando tarefas…")
            case let .content(tasks):
                List(tasks) { item in
                    TaskRow(item: item, canComplete: viewModel.canComplete(item)) {
                        Task { await viewModel.complete(item.id) }
                    }
                        .swipeActions {
                            if !item.occurrence.isCompleted && item.assignment == nil {
                                Button("Assumir") { Task { await viewModel.claim(item.id) } }.tint(.blue)
                            } else if viewModel.canComplete(item) {
                                Button("Devolver") { Task { await viewModel.release(item.id) } }.tint(.orange)
                            }
                        }
                }
            case .empty: EmptyStateView(title: "Nenhuma tarefa esporádica", systemImage: "sparkles")
            case let .failure(message): ContentUnavailableView("Não foi possível carregar", systemImage: "exclamationmark.triangle", description: Text(message))
            }
        }
        .navigationTitle("Esporádicas")
        .task { await viewModel.load() }
        .alert("Não foi possível concluir", isPresented: Binding(
            get: { viewModel.actionError != nil },
            set: { if !$0 { viewModel.actionError = nil } }
        )) {
            Button("OK") { viewModel.actionError = nil }
        } message: { Text(viewModel.actionError ?? "") }
        .refreshable { await viewModel.load() }
    }
}
