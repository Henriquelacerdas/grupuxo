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

    private var nameCard: some View {

        TextField(
            "Nome do cômodo",
            text: binding(\.name)
        )
        .textInputAutocapitalization(.sentences)
        .submitLabel(.done)
        .focused($isNameFocused)
        .onSubmit {

            Task {
                await viewModel.save()
            }
        }
        .accessibilityLabel("Nome do cômodo")
        .padding(DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    private var informationCard: some View {

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
    }

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
