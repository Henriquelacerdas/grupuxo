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
    /// Detalhes da segunda linha (todos opcionais): cômodo da tarefa editada ou apagada; tarefa que quem pediu a troca passa
    /// a fazer e até quando (`dueAt`, também o fim do ciclo na virada de ciclo); esforço de antes e de depois (1 a 3); e os
    /// outros responsáveis do cômodo.
    public let roomName: String?
    public let taskName: String?
    public let dueAt: Date?
    public let effortFrom: Int?
    public let effortTo: Int?
    public let names: [String]

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
        roomName: String? = nil,
        taskName: String? = nil,
        dueAt: Date? = nil,
        effortFrom: Int? = nil,
        effortTo: Int? = nil,
        names: [String] = [],
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
        self.roomName = roomName
        self.taskName = taskName
        self.dueAt = dueAt
        self.effortFrom = effortFrom
        self.effortTo = effortTo
        self.names = names
        self.createdAt = createdAt
        self.readAt = readAt
    }

    public var isRead: Bool {
        readAt != nil
    }
}
