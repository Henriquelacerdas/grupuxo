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
    case taskDeleted
    case effortChanged
    case memberJoined
    case memberLeft
    case roomDeleted
    case roomAccessRequested
    case roomAccessApproved
    case roomAccessDenied
    case cycleTurned
    case weeklySummaryReady
}

public struct AppNotification: Identifiable, Hashable, Codable, Sendable {

    public let id: UUID

    public let recipientUserID: User.ID
    public let kind: AppNotificationKind

    public let swapRequestID: TaskSwapRequest.ID?
    public let taskDefinitionID: TaskDefinition.ID?
    public let roomID: Room.ID?
    /// Quem fez a ação (nunca o destinatário).
    public let actorUserID: User.ID?
    /// Nome da tarefa, do cômodo ou do morador como era na hora do aviso (o objeto pode ter sido apagado).
    public let subjectName: String?
    /// Texto pronto (só o Mock usa); o servidor manda dados e o app monta o texto.
    public let message: String?

    public let createdAt: Date
    public var readAt: Date?

    public init(
        id: UUID,
        recipientUserID: User.ID,
        kind: AppNotificationKind,
        swapRequestID: TaskSwapRequest.ID? = nil,
        taskDefinitionID: TaskDefinition.ID? = nil,
        roomID: Room.ID? = nil,
        actorUserID: User.ID? = nil,
        subjectName: String? = nil,
        message: String? = nil,
        createdAt: Date,
        readAt: Date? = nil
    ) {
        self.id = id
        self.recipientUserID = recipientUserID
        self.kind = kind
        self.swapRequestID = swapRequestID
        self.taskDefinitionID = taskDefinitionID
        self.roomID = roomID
        self.actorUserID = actorUserID
        self.subjectName = subjectName
        self.message = message
        self.createdAt = createdAt
        self.readAt = readAt
    }

    public var isRead: Bool {
        readAt != nil
    }
}
