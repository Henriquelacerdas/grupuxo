// GUIA — Esta é a entrada para criar cômodo e cadastrar tarefas.
// TODO: adicionar ação de criação de cômodo e um formulário com nome, visibilidade,
// participantes e rotação semanal. Encaminhar a ação por callback/rota tipada.
// Usar ViewModel + caso de uso para salvar e recarregar a lista ao retornar.
// Manter o card de avulsas/esporádicas separado da lista interna dos cômodos.

import SwiftUI

struct HouseManagementView: View {
    @StateObject private var viewModel: HouseManagementViewModel
    @State private var isPresentingCreationSheet = false
    let onSelectRoom: (Room.ID) -> Void
    let onSelectSporadicTasks: () -> Void

    init(
        viewModel: HouseManagementViewModel,
        onSelectRoom: @escaping (Room.ID) -> Void,
        onSelectSporadicTasks: @escaping () -> Void
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onSelectRoom = onSelectRoom
        self.onSelectSporadicTasks = onSelectSporadicTasks
    }

    var body: some View {
        List {
            Section {
                Button(action: onSelectSporadicTasks) {
                    HStack(spacing: DesignSystem.contentSpacing) {
                        Image(systemName: "sparkles")
                            .font(.title2)
                            .foregroundStyle(.tint)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Tarefas esporádicas")
                                .font(.headline)
                            Text("Veja tarefas disponíveis para assumir")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Abrir tarefas esporádicas")
            }

            Section("Cômodos") {
                roomsContent
            }
        }
        .navigationTitle("Casa")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Adicionar tarefa", systemImage: "plus") {
                    isPresentingCreationSheet = true
                }
            }
        }
        .sheet(isPresented: $isPresentingCreationSheet) {
            NavigationStack {
                ContentUnavailableView(
                    "Adicionar à casa",
                    systemImage: "plus.circle",
                    description: Text("O conteúdo deste modal será implementado em breve.")
                )
                .navigationTitle("Adicionar")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Fechar") {
                            isPresentingCreationSheet = false
                        }
                    }
                }
            }
        }
        .task { if viewModel.state == .idle { await viewModel.load() } }
        .refreshable { await viewModel.load() }
    }

    @ViewBuilder
    private var roomsContent: some View {
        switch viewModel.state {
        case .idle, .loading:
            HStack {
                Spacer()
                ProgressView("Carregando cômodos…")
                Spacer()
            }
        case let .content(rooms):
            ForEach(rooms) { room in
                Button(room.name) { onSelectRoom(room.id) }
            }
        case .empty:
            Text("Nenhum cômodo cadastrado.")
                .foregroundStyle(.secondary)
        case let .failure(message):
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
        }
    }
}
