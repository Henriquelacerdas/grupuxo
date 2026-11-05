//
//  TaskSwapView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import SwiftUI
import GrupuxoDomain

/// "Pedir troca" (sheet): sua tarefa no topo e as tarefas que você pode pedir, agrupadas por esforço.
struct TaskSwapView: View {

    @Environment(\.dismiss) private var dismiss
    @Environment(\.showToast) private var showToast

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

            case let .content(offeredTask, candidates):
                content(offered: offeredTask, candidates: candidates)

            case .sent:
                ContentUnavailableView(
                    "Pedido enviado",
                    systemImage: "checkmark.circle",
                    description: Text("A pessoa recebeu o seu pedido de troca.")
                )

            case let .failure(message):
                ContentUnavailableView(
                    "Não foi possível pedir a troca",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Pedir troca")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Fechar", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
            }

            ToolbarItem(placement: .confirmationAction) {
                if viewModel.isSending {
                    ProgressView()
                } else if case .content = viewModel.state {
                    Button("Pedir troca", systemImage: "checkmark") {
                        Task { await viewModel.sendSelected() }
                    }
                    .labelStyle(.iconOnly)
                    .disabled(viewModel.selectedID == nil)
                }
            }
        }
        .onChange(of: viewModel.state) { _, state in
            switch state {
            case .sent:
                Haptics.success()
                showToast(.created(String(localized: "Pedido de troca enviado")))
                dismiss()
            case .failure:
                Haptics.error()
            default:
                break
            }
        }
        .task {
            if case .idle = viewModel.state {
                await viewModel.load()
            }
        }
    }

    private func content(offered: TaskItem, candidates: [TaskItem]) -> some View {

        let groups = viewModel.groups(offered: offered, candidates: candidates)

        return List {

            Section {
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                    Text(offered.definition.name)
                        .font(.headline)
                    Text(viewModel.offeredSummary(offered))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, DesignSystem.Spacing.extraSmall)
            } header: {
                Text("Sua tarefa")
            }

            if groups.isEmpty {
                ContentUnavailableView(
                    "Nenhuma troca disponível",
                    systemImage: "arrow.left.arrow.right",
                    description: Text("Não há tarefas que você possa pedir em troca agora.")
                )
                .listRowBackground(Color.clear)
            }

            ForEach(groups) { group in
                Section {
                    ForEach(group.items) { candidate in
                        candidateRow(candidate)
                    }
                } header: {
                    HStack(spacing: DesignSystem.Spacing.small) {
                        Text(RoomDetailText.effort(TaskEffort(points: group.effort.rawValue)))
                        if group.isSameEffort {
                            Text("Mesmo esforço")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, DesignSystem.Spacing.small)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(.tint))
                        }
                    }
                } footer: {
                    if group.isSameEffort {
                        Text("Trocar por uma tarefa de mesmo esforço é o mais justo.")
                    } else if group == groups.last {
                        Text("A pessoa precisa aceitar para a troca valer.")
                    }
                }
            }
        }
    }

    private func candidateRow(_ candidate: TaskItem) -> some View {

        let isSelected = viewModel.selectedID == candidate.id

        return Button {
            viewModel.select(candidate.id)
        } label: {
            HStack(spacing: DesignSystem.Spacing.medium) {

                if let assignee = candidate.assignee {
                    ResidentAvatar(user: assignee)
                        .accessibilityHidden(true)
                }

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                    Text(candidate.definition.name)
                        .foregroundStyle(.primary)
                    Text(viewModel.candidateSummary(candidate))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isSending)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
