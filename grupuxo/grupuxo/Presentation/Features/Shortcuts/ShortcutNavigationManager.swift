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

@MainActor
final class ShortcutNavigationManager: ObservableObject {

    static let shared = ShortcutNavigationManager()

    @Published var pendingDestination: ShortcutDestination?
    @Published var pendingTaskDraft: TaskDraft?

    private init() {}

    func navigate(to destination: ShortcutDestination) {
        pendingDestination = destination
    }
    func openTaskCreation(draft: TaskDraft) {
        pendingTaskDraft = draft
    }
    func clearPendingTask() {
        pendingTaskDraft = nil
    }
}
