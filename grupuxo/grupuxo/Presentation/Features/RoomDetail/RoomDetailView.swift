import SwiftUI

struct RoomDetailView: View {
    @StateObject private var viewModel: RoomDetailViewModel

    init(viewModel: RoomDetailViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading: ProgressView("Carregando cômodo…")
            case let .content(content):
                List(content.tasks) { item in
                    TaskRow(item: item, canComplete: viewModel.canComplete(item)) {
                        Task { await viewModel.complete(item.id) }
                    }
                }
                    .navigationTitle(content.room.name)
            case let .empty(room): EmptyStateView(title: "Sem tarefas em \(room.name)", systemImage: "tray")
            case let .failure(message): ContentUnavailableView("Não foi possível carregar", systemImage: "exclamationmark.triangle", description: Text(message))
            }
        }
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
