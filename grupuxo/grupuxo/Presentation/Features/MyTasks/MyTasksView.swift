import SwiftUI

struct MyTasksView: View {
    @StateObject private var viewModel: MyTasksViewModel

    init(viewModel: MyTasksViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading: ProgressView("Carregando tarefas…")
            case let .content(tasks):
                List(tasks) { item in
                    TaskRow(item: item)
                        .swipeActions {
                            Button("Concluir", systemImage: "checkmark") {
                                Task { await viewModel.complete(item.occurrence.id) }
                            }.tint(.green)
                        }
                }
            case .empty: EmptyStateView(title: "Nenhuma tarefa", systemImage: "checklist")
            case let .failure(message): ContentUnavailableView("Não foi possível carregar", systemImage: "exclamationmark.triangle", description: Text(message))
            }
        }
        .navigationTitle("Minhas tarefas")
        .task { if viewModel.state == .idle { await viewModel.load() } }
        .refreshable { await viewModel.load() }
    }
}
