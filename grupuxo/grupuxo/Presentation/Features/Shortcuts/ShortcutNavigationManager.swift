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

    private init() {}

    func navigate(to destination: ShortcutDestination) {
        pendingDestination = destination
    }
}
