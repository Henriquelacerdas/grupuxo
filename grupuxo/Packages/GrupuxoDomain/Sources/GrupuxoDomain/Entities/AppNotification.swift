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
}

public struct AppNotification: Identifiable, Hashable, Codable, Sendable {

    public let id: UUID

    public let recipientUserID: User.ID
    public let kind: AppNotificationKind

    public let swapRequestID: TaskSwapRequest.ID

    public let createdAt: Date
    public var readAt: Date?

    public init(
        id: UUID,
        recipientUserID: User.ID,
        kind: AppNotificationKind,
        swapRequestID: TaskSwapRequest.ID,
        createdAt: Date,
        readAt: Date?
    ) {
        self.id = id
        self.recipientUserID = recipientUserID
        self.kind = kind
        self.swapRequestID = swapRequestID
        self.createdAt = createdAt
        self.readAt = readAt
    }

    public var isRead: Bool {
        readAt != nil
    }
}
