//
//  AppNotification.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public enum AppNotificationKind: String, Codable, Sendable {
    case taskSwapRequested
    case taskSwapAccepted
    case taskSwapRejected

    case taskEdited
}

public struct AppNotification: Identifiable, Hashable, Codable, Sendable {

    public let id: UUID

    public let recipientUserID: User.ID
    public let kind: AppNotificationKind

    public let swapRequestID: TaskSwapRequest.ID?
    public let taskDefinitionID: TaskDefinition.ID?
    public let message: String?

    public let createdAt: Date
    public var readAt: Date?

    public init(
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

    public var isRead: Bool {
        readAt != nil
    }
}
