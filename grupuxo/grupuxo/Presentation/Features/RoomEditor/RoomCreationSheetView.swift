//
//  RoomCreationSheetView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 18/09/26.
//

import SwiftUI

struct RoomCreationSheetView: View {

    @Environment(\.dismiss) private var dismiss
    @FocusState private var isNameFocused: Bool

    @StateObject private var viewModel: RoomEditorViewModel

    private enum Layout {
        static let cardCornerRadius: CGFloat = 16
    }

    init(viewModel: RoomEditorViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {

        NavigationStack {

            ScrollView {

                VStack(
                    spacing: DesignSystem.Spacing.large
                ) {

                    nameCard

                    categoryCard

                    visibilityCard

                    informationCard

                    if case let .failure(_, message) = viewModel.state {

                        Label(
                            message,
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                    }
                }
                .padding(DesignSystem.Spacing.large)
                .disabled(isSaving)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(
                Color(uiColor: .systemGroupedBackground)
            )
            .navigationTitle("Criar cômodo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {

                ToolbarItem(
                    placement: .cancellationAction
                ) {

                    Button(
                        "Fechar",
                        systemImage: "xmark"
                    ) {
                        dismiss()
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Fechar")
                    .disabled(isSaving)
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {

                    if isSaving {

                        ProgressView("Salvando cômodo")

                    } else {

                        Button(
                            "Salvar",
                            systemImage: "checkmark"
                        ) {

                            isNameFocused = false

                            Task {
                                await viewModel.save()
                            }
                        }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Salvar cômodo")
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSaving)
        .onChange(of: viewModel.state) { _, state in

            if case .saved = state {
                dismiss()
            }
        }
    }

    // MARK: - Nome

    private var nameCard: some View {

        TextField(
            "Nome do cômodo",
            text: binding(\.name)
        )
        .textInputAutocapitalization(.sentences)
        .submitLabel(.done)
        .focused($isNameFocused)
        .onSubmit {
            isNameFocused = false
        }
        .accessibilityLabel("Nome do cômodo")
        .padding(DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    // MARK: - Categoria

    private var categoryCard: some View {

        HStack(
            spacing: DesignSystem.Spacing.large
        ) {

            Label(
                "Tipo de cômodo",
                systemImage: "square.grid.2x2"
            )
            .font(.callout.weight(.medium))

            Spacer()

            Picker(
                "Tipo de cômodo",
                selection: binding(\.category)
            ) {

                Text("Cozinha")
                    .tag(RoomCategory.kitchen)

                Text("Banheiro")
                    .tag(RoomCategory.bathroom)

                Text("Quarto")
                    .tag(RoomCategory.bedroom)

                Text("Sala")
                    .tag(RoomCategory.livingRoom)

                Text("Lavanderia")
                    .tag(RoomCategory.laundry)

                Text("Escritório")
                    .tag(RoomCategory.office)

                Text("Área externa")
                    .tag(RoomCategory.outdoor)

                Text("Outro")
                    .tag(RoomCategory.other)
            }
            .pickerStyle(.menu)
            .accessibilityLabel("Tipo de cômodo")
        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
        .padding(DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    // MARK: - Acesso

    private var visibilityCard: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.medium
        ) {

            Label(
                "Acesso ao cômodo",
                systemImage: "lock.shield"
            )
            .font(.callout.weight(.medium))

            Picker(
                "Acesso ao cômodo",
                selection: binding(\.visibility)
            ) {

                Text("Comum")
                    .tag(RoomVisibility.common)

                Text("Privado")
                    .tag(RoomVisibility.privateRoom)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Acesso ao cômodo")
        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
        .padding(DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    // MARK: - Informações

    @ViewBuilder
    private var informationCard: some View {

        switch viewModel.state.draft.visibility {

        case .common:

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.large
            ) {

                Label(
                    "Todos os moradores da casa participarão deste cômodo.",
                    systemImage: "person.3"
                )

                Divider()

                Label(
                    "Rotação semanal",
                    systemImage: "arrow.triangle.2.circlepath"
                )
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(
                maxWidth: .infinity,
                alignment: .leading
            )
            .padding(DesignSystem.Spacing.large)
            .background(cardBackground)

        case .privateRoom:

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.large
            ) {

                Label(
                    "Somente você participará deste cômodo inicialmente.",
                    systemImage: "person"
                )

                Divider()

                Label(
                    "Outros moradores poderão solicitar acesso.",
                    systemImage: "person.badge.plus"
                )

                Divider()

                Label(
                    "Não participa da rotação semanal.",
                    systemImage: "arrow.triangle.2.circlepath"
                )
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(
                maxWidth: .infinity,
                alignment: .leading
            )
            .padding(DesignSystem.Spacing.large)
            .background(cardBackground)
        }
    }

    // MARK: - Helpers

    private var cardBackground: some View {

        RoundedRectangle(
            cornerRadius: Layout.cardCornerRadius,
            style: .continuous
        )
        .fill(
            Color(
                uiColor: .secondarySystemGroupedBackground
            )
        )
    }

    private var isSaving: Bool {

        if case .saving = viewModel.state {
            return true
        }

        return false
    }

    private func binding<Value>(
        _ keyPath: WritableKeyPath<RoomDraft, Value>
    ) -> Binding<Value> {

        Binding(
            get: {
                viewModel.state.draft[
                    keyPath: keyPath
                ]
            },
            set: { value in

                viewModel.updateDraft {
                    $0[keyPath: keyPath] = value
                }
            }
        )
    }
}
