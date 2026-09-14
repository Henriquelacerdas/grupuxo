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
                List(content.tasks) { TaskRow(item: $0) }
                    .navigationTitle(content.room.name)
            case let .empty(room): EmptyStateView(title: "Sem tarefas em \(room.name)", systemImage: "tray")
            case let .failure(message): ContentUnavailableView("Não foi possível carregar", systemImage: "exclamationmark.triangle", description: Text(message))
            }
        }
        .task { if viewModel.state == .idle { await viewModel.load() } }
        .refreshable { await viewModel.load() }
    }
}
