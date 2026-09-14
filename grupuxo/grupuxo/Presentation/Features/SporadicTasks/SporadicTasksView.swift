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
                    TaskRow(item: item)
                        .swipeActions {
                            if item.assignment == nil {
                                Button("Assumir") { Task { await viewModel.claim(item.id) } }.tint(.blue)
                            } else {
                                Button("Devolver") { Task { await viewModel.release(item.id) } }.tint(.orange)
                            }
                        }
                }
            case .empty: EmptyStateView(title: "Nenhuma tarefa esporádica", systemImage: "sparkles")
            case let .failure(message): ContentUnavailableView("Não foi possível carregar", systemImage: "exclamationmark.triangle", description: Text(message))
            }
        }
        .navigationTitle("Esporádicas")
        .task { if viewModel.state == .idle { await viewModel.load() } }
        .refreshable { await viewModel.load() }
    }
}
