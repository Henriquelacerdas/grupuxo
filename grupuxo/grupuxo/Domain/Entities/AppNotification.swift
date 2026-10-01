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

    case taskEdited

}

struct AppNotification:
    Identifiable,
    Hashable,
    Codable,
    Sendable {

    let id: UUID

    let recipientUserID: User.ID

    let kind: AppNotificationKind

    let swapRequestID: TaskSwapRequest.ID?

    let taskDefinitionID: TaskDefinition.ID?

    let message: String?

    let createdAt: Date

    var readAt: Date?

    var isRead: Bool {
        readAt != nil
    }

    init(
        id: UUID,
        recipientUserID: User.ID,
        kind: AppNotificationKind,
        swapRequestID: TaskSwapRequest.ID? = nil,
        taskDefinitionID: TaskDefinition.ID? = nil,
        message: String? = nil,
        createdAt: Date,
        readAt: Date? = nil
    ) {

        self.id = id
        self.recipientUserID = recipientUserID
        self.kind = kind
        self.swapRequestID = swapRequestID
        self.taskDefinitionID = taskDefinitionID
        self.message = message
        self.createdAt = createdAt
        self.readAt = readAt

    }

}
