//
//  TaskDetailView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 30/09/26.
//

import Foundation
import SwiftUI
import GrupuxoDomain

struct TaskDetailView: View {

    @StateObject private var viewModel: TaskDetailViewModel

    @State private var editingDefinition: TaskDefinition?

    init(
        viewModel: TaskDetailViewModel
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
                    "Carregando tarefa…"
                )

            case let .content(definition):

                List {

                    Section("Tarefa") {

                        LabeledContent(
                            "Nome",
                            value: definition.name
                        )

                        if !definition.details.isEmpty {

                            VStack(
                                alignment: .leading,
                                spacing: DesignSystem.Spacing.extraSmall
                            ) {

                                Text("Descrição")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                Text(
                                    definition.details
                                )

                            }

                        }

                    }

                    Section("Configuração") {

                        LabeledContent(
                            "Esforço",
                            value: effortName(
                                definition.effort.points
                            )
                        )

                        LabeledContent(
                            "Tipo",
                            value: kindName(
                                definition.kind
                            )
                        )

                        LabeledContent(
                            "Repetição",
                            value: recurrenceName(
                                definition.recurrence
                            )
                        )

                        LabeledContent(
                            "Distribuição",
                            value: assignmentName(
                                definition.assignmentPolicy
                            )
                        )

                    }

                }

            case let .failure(message):

                ContentUnavailableView(
                    "Não foi possível carregar",
                    systemImage: "exclamationmark.triangle",
                    description: Text(
                        message
                    )
                )

            }

        }
        .navigationTitle(
            "Detalhes da tarefa"
        )
        .navigationBarTitleDisplayMode(
            .inline
        )
        .toolbar {

            ToolbarItem(
                placement: .topBarTrailing
            ) {

                if case let .content(definition) =
                    viewModel.state {

                    Button(
                        "Editar",
                        systemImage: "pencil"
                    ) {

                        editingDefinition =
                            definition

                    }

                }

            }

        }
        .sheet(
            item: $editingDefinition
        ) { definition in

            TaskDetailsEditSheet(
                viewModel: viewModel,
                definition: definition
            )

        }
        .task {

            await viewModel.load()

        }

    }

    private func effortName(
        _ points: Int
    ) -> String {

        switch points {

        case 1:
            return "Leve"

        case 2:
            return "Médio"

        case 3:
            return "Intenso"

        default:
            return "\(points)"

        }

    }

    private func kindName(
        _ kind: TaskKind
    ) -> String {

        switch kind {

        case .recurring:
            return "Recorrente"

        case .sporadic:
            return "Esporádica"

        }

    }

    private func recurrenceName(
        _ recurrence: RecurrencePolicy
    ) -> String {

        switch recurrence {

        case .none:

            return "Sem repetição"

        case let .recurring(
            frequency,
            interval
        ):

            switch frequency {

            case .daily:

                return interval == 1
                    ? "Diariamente"
                    : "A cada \(interval) dias"

            case .weekly:

                return interval == 1
                    ? "Semanalmente"
                    : "A cada \(interval) semanas"

            case .monthly:

                return interval == 1
                    ? "Mensalmente"
                    : "A cada \(interval) meses"

            case .yearly:

                return interval == 1
                    ? "Anualmente"
                    : "A cada \(interval) anos"

            }

        default:

            return "Periodicidade do cômodo"

        }

    }

    private func assignmentName(
        _ policy: TaskAssignmentPolicy
    ) -> String {

        switch policy {

        case .balancedAutomatically:
            return "Equilibrada automaticamente"

        case .calendarRotation:
            return "Rotação por calendário"

        case .afterCompletion:
            return "Após conclusão"

        case .selfAssigned:
            return "Assumida por um morador"

        }

    }

}


private struct TaskDetailsEditSheet: View {

    @Environment(\.dismiss)
    private var dismiss

    @ObservedObject
    var viewModel: TaskDetailViewModel

    @State
    private var name: String

    @State
    private var details: String

    init(
        viewModel: TaskDetailViewModel,
        definition: TaskDefinition
    ) {

        self.viewModel = viewModel

        _name = State(
            initialValue: definition.name
        )

        _details = State(
            initialValue: definition.details
        )

    }

    var body: some View {

        NavigationStack {

            Form {

                Section("Tarefa") {

                    TextField(
                        "Nome",
                        text: $name
                    )

                    TextField(
                        "Descrição",
                        text: $details,
                        axis: .vertical
                    )
                    .lineLimit(3...6)

                }

            }
            .navigationTitle(
                "Editar tarefa"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {

                ToolbarItem(
                    placement: .cancellationAction
                ) {

                    Button("Cancelar") {

                        dismiss()

                    }
                    .disabled(
                        viewModel.isSaving
                    )

                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {

                    if viewModel.isSaving {

                        ProgressView()

                    } else {

                        Button("Salvar") {

                            Task {

                                let saved =
                                    await viewModel.update(
                                        name: name,
                                        details: details
                                    )

                                if saved {
                                    dismiss()
                                }

                            }

                        }
                        .disabled(
                            name
                                .trimmingCharacters(
                                    in: .whitespacesAndNewlines
                                )
                                .isEmpty
                        )

                    }

                }

            }

        }
        .alert(
            "Não foi possível salvar",
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

    }

}
