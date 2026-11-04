//
//  ShortcutNavigationManager.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 03/11/26.
//

import Foundation
import Combine

enum ShortcutDestination {
    case myTasks
    case house
    case sporadicTasks
}

/// Pedido de criação de tarefa vindo do atalho.
struct ShortcutTaskRequest: Equatable {
    var draft: TaskDraft
    /// Nome do cômodo falado/digitado; `nil` usa a Casa toda.
    var roomName: String?
    /// `true` salva direto; `false` abre o formulário para confirmar.
    var saveAutomatically: Bool
}

@MainActor
final class ShortcutNavigationManager: ObservableObject {

    static let shared = ShortcutNavigationManager()

    @Published var pendingDestination: ShortcutDestination?
    @Published var pendingTaskRequest: ShortcutTaskRequest?

    private init() {}

    func navigate(to destination: ShortcutDestination) {
        pendingDestination = destination
    }
    func openTaskCreation(_ request: ShortcutTaskRequest) {
        pendingTaskRequest = request
    }
    func clearPendingTask() {
        pendingTaskRequest = nil
    }
}
