//
//  NewTaskIntent.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 04/11/26.
//

import AppIntents
import GrupuxoDomain

struct CreateTaskIntent: AppIntent {

    static let title: LocalizedStringResource =
        "Criar Tarefa"

    static let description = IntentDescription(
        "Cria uma tarefa no cômodo escolhido, com a periodicidade do cômodo."
    )

    /// Roda em segundo plano: o app não abre.
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Nome da tarefa")
    var taskName: String

    @Parameter(title: "Cômodo")
    var room: RoomEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Criar \(\.$taskName) em \(\.$room)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {

        let context = try await ShortcutBackend.context()

        let rooms = try await ShortcutBackend.loadRooms()
        guard let selectedRoom = rooms.first(where: { $0.id == room.id }) else {
            throw ShortcutError.roomNotFound
        }

        var draft = TaskDraft()
        draft.name = taskName
        draft.roomID = selectedRoom.id
        draft.kind = .recurring
        // Período padrão do cômodo (mesma regra de "usar a periodicidade do cômodo").
        draft.recurrence = .weekly(selectedRoom.periodicity)
        draft.assignmentPolicy = .balancedAutomatically

        let viewModel = context.container.makeTaskEditorViewModel(
            draft: draft,
            session: context.session
        )
        await viewModel.save()

        switch viewModel.state {
        case .saved:
            return .result(
                dialog: "Tarefa \(taskName) criada em \(selectedRoom.name)."
            )
        case let .failure(_, message):
            throw ShortcutError.saveFailed(message)
        default:
            throw ShortcutError.saveFailed("")
        }
    }
}
