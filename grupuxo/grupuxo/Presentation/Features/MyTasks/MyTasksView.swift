import SwiftUI

struct MyTasksView: View {

    @StateObject private var viewModel: MyTasksViewModel

    let onRequestSwap: (TaskOccurrence.ID) -> Void
    let onSelectNotifications: () -> Void
    let onSelectProfile: () -> Void
    /// Muda quando a aba volta a ficar ativa, forçando um novo carregamento.
    let reloadTrigger: AnyHashable

    init(
        viewModel: MyTasksViewModel,
        onRequestSwap: @escaping (TaskOccurrence.ID) -> Void,
        onSelectNotifications: @escaping () -> Void,
        onSelectProfile: @escaping () -> Void,
        reloadTrigger: AnyHashable = 0
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onRequestSwap = onRequestSwap
        self.onSelectNotifications = onSelectNotifications
        self.onSelectProfile = onSelectProfile
        self.reloadTrigger = reloadTrigger
    }

    var body: some View {
        Group {

            switch viewModel.state {

            case .idle, .loading:
                ProgressView("Carregando tarefas…")

            case let .content(tasks):
                List(tasks) { item in

                    VStack(
                        alignment: .leading,
                        spacing: 10
                    ) {

                        TaskRow(
                            item: item,
                            canComplete: viewModel.canComplete(item)
                        ) {
                            Task {
                                await viewModel.complete(item.id)
                            }
                        }

                        if viewModel.canRequestSwap(item) {

                            Button {
                                onRequestSwap(item.id)
                            } label: {
                                Label(
                                    "Solicitar troca",
                                    systemImage: "arrow.left.arrow.right"
                                )
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }

            case .empty:
                EmptyStateView(
                    title: "Nenhuma tarefa",
                    systemImage: "checklist"
                )

            case let .failure(message):
                ContentUnavailableView(
                    "Não foi possível carregar",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .navigationTitle("Minhas tarefas")
        .toolbar {
            ToolbarItemGroup(
                placement: .topBarTrailing
            ) {
                Button(
                    "Notificações",
                    systemImage: "bell",
                    action: onSelectNotifications
                )

                Button(
                    "Perfil",
                    systemImage: "person.circle",
                    action: onSelectProfile
                )
            }
        }
        .task(id: reloadTrigger) {
            if case .idle = viewModel.state {
                await viewModel.load()
            } else {
                await viewModel.load(showLoading: false)
            }
        }
        .alert(
            "Não foi possível atualizar a tarefa",
            isPresented: Binding(
                get: {
                    viewModel.actionError != nil
                },
                set: {
                    if !$0 {
                        viewModel.actionError = nil
                    }
                }
            )
        ) {
            Button("OK") {
                viewModel.actionError = nil
            }
        } message: {
            Text(
                viewModel.actionError ?? ""
            )
        }
        .refreshable {
            await viewModel.load()
        }
    }
}
