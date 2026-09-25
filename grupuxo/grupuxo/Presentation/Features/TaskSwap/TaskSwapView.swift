//
//  TaskSwapView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import SwiftUI

struct TaskSwapView: View {

    @StateObject private var viewModel: TaskSwapViewModel

    init(
        viewModel: TaskSwapViewModel
    ) {
        _viewModel = StateObject(
            wrappedValue: viewModel
        )
    }

    var body: some View {
        Group {
            switch viewModel.state {

            case .idle, .loading:
                ProgressView(
                    "Carregando tarefas…"
                )

            case let .content(
                offeredTask,
                candidates
            ):
                List {

                    Section(
                        "Sua tarefa"
                    ) {
                        taskDescription(
                            offeredTask
                        )
                    }

                    Section(
                        "Escolha uma tarefa para receber"
                    ) {

                        if candidates.isEmpty {

                            ContentUnavailableView(
                                "Nenhuma troca disponível",
                                systemImage:
                                    "arrow.left.arrow.right",
                                description: Text(
                                    "Não há tarefas elegíveis para troca no momento."
                                )
                            )

                        } else {

                            ForEach(
                                candidates
                            ) { candidate in

                                Button {
                                    Task {
                                        await viewModel.requestSwap(
                                            requestedOccurrenceID:
                                                candidate.id
                                        )
                                    }

                                } label: {

                                    VStack(
                                        alignment: .leading,
                                        spacing: 4
                                    ) {

                                        Text(
                                            candidate.definition.name
                                        )
                                        .font(.headline)

                                        if let assignee =
                                            candidate.assignee {

                                            Text(
                                                "Responsável: \(assignee.name)"
                                            )
                                            .font(.subheadline)
                                            .foregroundStyle(
                                                .secondary
                                            )
                                        }

                                        Text(
                                            "Esforço: \(candidate.occurrence.effortSnapshot.points)"
                                        )
                                        .font(.caption)
                                        .foregroundStyle(
                                            .secondary
                                        )
                                    }
                                }
                                .disabled(
                                    viewModel.isSending
                                )
                            }
                        }
                    }
                }

            case .sent:
                ContentUnavailableView(
                    "Solicitação enviada",
                    systemImage:
                        "checkmark.circle",
                    description: Text(
                        "O outro morador recebeu sua solicitação de troca."
                    )
                )

            case let .failure(message):
                ContentUnavailableView(
                    "Não foi possível realizar a troca",
                    systemImage:
                        "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .navigationTitle(
            "Solicitar troca"
        )
        .task {
            if case .idle = viewModel.state {
                await viewModel.load()
            }
        }
    }

    @ViewBuilder
    private func taskDescription(
        _ item: TaskItem
    ) -> some View {

        VStack(
            alignment: .leading,
            spacing: 4
        ) {

            Text(
                item.definition.name
            )
            .font(.headline)

            if !item.definition.details.isEmpty {
                Text(
                    item.definition.details
                )
                .foregroundStyle(
                    .secondary
                )
            }

            Text(
                "Esforço: \(item.occurrence.effortSnapshot.points)"
            )
            .font(.caption)
            .foregroundStyle(
                .secondary
            )
        }
    }
}
