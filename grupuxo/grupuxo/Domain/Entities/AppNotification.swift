//
//  AppNotification.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

enum AppNotificationKind: String, Codable, Sendable {
    case taskSwapRequested
    case taskSwapAccepted
    case taskSwapRejected
}

struct AppNotification: Identifiable, Hashable, Codable, Sendable {

    let id: UUID

    let recipientUserID: User.ID
    let kind: AppNotificationKind

    let swapRequestID: TaskSwapRequest.ID

    let createdAt: Date
    var readAt: Date?

    var isRead: Bool {
        readAt != nil
    }
}
