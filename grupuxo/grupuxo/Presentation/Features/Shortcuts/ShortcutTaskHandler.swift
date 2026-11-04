//
//  ShortcutTaskHandler.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 04/11/26.
//

import SwiftUI
import GrupuxoDomain

/// Recebe o pedido do atalho "Criar Tarefa": resolve o cômodo (ou Casa toda) e
/// salva direto, ou abre o formulário preenchido quando o usuário pediu para confirmar.
struct ShortcutTaskHandler: ViewModifier {

    let container: AppContainer
    let session: AppSession

    @Binding var selectedTab: AppTab
    @Binding var taskChanges: Int

    @ObservedObject private var manager = ShortcutNavigationManager.shared
    @Environment(\.showToast) private var showToast

    @State private var sheet: ShortcutSheet?

    private struct ShortcutSheet: Identifiable {
        let id = UUID()
        let draft: TaskDraft
    }

    func body(content: Content) -> some View {
        content
            .onChange(of: manager.pendingTaskRequest, initial: true) { _, request in
                guard let request else { return }
                manager.clearPendingTask()
                Task { await handle(request) }
            }
            .sheet(
                item: $sheet,
                onDismiss: { taskChanges += 1 }
            ) { sheet in
                TaskCreationSheetView(
                    viewModel: container.makeTaskEditorViewModel(
                        draft: sheet.draft,
                        session: session
                    )
                )
                .presentationDragIndicator(.visible)
            }
    }

    @MainActor
    private func handle(_ request: ShortcutTaskRequest) async {

        let rooms = (try? await container.makeGetHouseRoomsUseCase()(
            houseID: session.currentHouse.id,
            userID: session.currentUser.id,
            participatingOnly: true
        )) ?? []

        let requestedRoom = request.roomName.flatMap { match($0, in: rooms) }
        let wholeHouse = rooms.first(where: \.representsWholeHouse)

        // Sem cômodo informado → Casa toda.
        let room = requestedRoom ?? wholeHouse

        // Falou um cômodo que não existe: não salva no lugar errado, pede confirmação.
        let roomNotFound = request.roomName != nil && requestedRoom == nil

        var draft = request.draft
        draft.roomID = room?.id

        guard request.saveAutomatically, !roomNotFound, let room else {
            selectedTab = .house
            sheet = ShortcutSheet(draft: draft)
            return
        }

        let viewModel = container.makeTaskEditorViewModel(
            draft: draft,
            session: session
        )
        await viewModel.save()

        if case let .saved(definition) = viewModel.state {
            taskChanges += 1
            showToast(.created(
                String(localized: "Tarefa “\(definition.name)” criada em \(room.name)")
            ))
        } else {
            // Falhou: abre o formulário para o usuário revisar e tentar de novo.
            selectedTab = .house
            sheet = ShortcutSheet(draft: draft)
        }
    }

    private func match(_ name: String, in rooms: [Room]) -> Room? {
        func normalize(_ text: String) -> String {
            text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let target = normalize(name)
        guard !target.isEmpty else { return nil }

        return rooms.first { normalize($0.name) == target }
            ?? rooms.first { normalize($0.name).contains(target) }
    }
}
