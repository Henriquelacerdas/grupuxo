import SwiftUI

struct RoomDetailView: View {

    @StateObject private var viewModel: RoomDetailViewModel

    @State private var selectedSuggestion: TaskSuggestion?

    private let makeSuggestionEditorViewModel:
        (TaskSuggestion) -> TaskEditorViewModel

    init(
        viewModel: RoomDetailViewModel,
        makeSuggestionEditorViewModel:
            @escaping (TaskSuggestion) -> TaskEditorViewModel
    ) {
        _viewModel = StateObject(
            wrappedValue: viewModel
        )

        self.makeSuggestionEditorViewModel =
            makeSuggestionEditorViewModel
    }

    var body: some View {

        Group {

            switch viewModel.state {

            case .idle, .loading:

                ProgressView(
                    "Carregando cômodo…"
                )

            case let .content(content):

                roomContent(
                    room: content.room,
                    tasks: content.tasks
                )

            case let .empty(room):

                if viewModel.suggestions.isEmpty {

                    EmptyStateView(
                        title: "Sem tarefas em \(room.name)",
                        systemImage: "tray"
                    )

                } else {

                    roomContent(
                        room: room,
                        tasks: []
                    )
                }

            case let .failure(message):

                ContentUnavailableView(
                    "Não foi possível carregar",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .task {
            await viewModel.load()
        }
        .sheet(
            item: $selectedSuggestion,
            onDismiss: {
                Task {
                    await viewModel.load()
                }
            }
        ) { suggestion in

            TaskCreationSheetView(
                viewModel:
                    makeSuggestionEditorViewModel(
                        suggestion
                    )
            )
        }
        .alert(
            "Não foi possível concluir",
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

    @ViewBuilder
    private func roomContent(
        room: Room,
        tasks: [TaskItem]
    ) -> some View {

        List {

            if !tasks.isEmpty {

                Section("Tarefas") {

                    ForEach(tasks) { item in

                        TaskRow(
                            item: item,
                            canComplete:
                                viewModel.canComplete(
                                    item
                                )
                        ) {

                            Task {
                                await viewModel.complete(
                                    item.id
                                )
                            }
                        }
                    }
                }
            }

            if !viewModel.suggestions.isEmpty {

                Section {

                    ForEach(
                        viewModel.suggestions
                    ) { suggestion in

                        Button {

                            selectedSuggestion =
                                suggestion

                        } label: {

                            suggestionRow(
                                suggestion
                            )
                        }
                        .buttonStyle(.plain)
                    }

                } header: {

                    Text("Sugestões")

                } footer: {

                    Text(
                        "Toque em uma sugestão para editar e adicionar ao cômodo."
                    )
                }
            }
        }
        .navigationTitle(room.name)
    }

    private func suggestionRow(
        _ suggestion: TaskSuggestion
    ) -> some View {

        HStack(
            spacing: DesignSystem.Spacing.medium
        ) {

            Image(
                systemName: "sparkles"
            )
            .foregroundStyle(.secondary)

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.extraSmall
            ) {

                Text(suggestion.name)
                    .foregroundStyle(.primary)

                Text(
                    effortName(
                        suggestion.effort.points
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            Spacer()

            Text(
                "\(suggestion.effort.points)"
            )
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)

            Image(
                systemName: "chevron.right"
            )
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(
            children: .combine
        )
        .accessibilityHint(
            "Abre o formulário para editar e adicionar esta tarefa."
        )
    }

    private func effortName(
        _ points: Int
    ) -> String {

        switch points {

        case 1:
            return "Fácil"

        case 2:
            return "Médio"

        default:
            return "Difícil"
        }
    }
}
