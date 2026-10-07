//
//  TaskSwapRequest.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public enum TaskSwapRequestStatus: String, Codable, Sendable {
    case pending
    case accepted
    case rejected
}

public struct TaskSwapRequest: Identifiable, Hashable, Codable, Sendable {

    public let id: UUID

    public let requesterID: User.ID
    public let receiverID: User.ID

    public let offeredOccurrenceID: TaskOccurrence.ID
    public let requestedOccurrenceID: TaskOccurrence.ID

    public var status: TaskSwapRequestStatus

    public let createdAt: Date
    public var resolvedAt: Date?

    public init(
        id: UUID,
        requesterID: User.ID,
        receiverID: User.ID,
        offeredOccurrenceID: TaskOccurrence.ID,
        requestedOccurrenceID: TaskOccurrence.ID,
        status: TaskSwapRequestStatus,
        createdAt: Date,
        resolvedAt: Date?
    ) {
        self.id = id
        self.requesterID = requesterID
        self.receiverID = receiverID
        self.offeredOccurrenceID = offeredOccurrenceID
        self.requestedOccurrenceID = requestedOccurrenceID
        self.status = status
        self.createdAt = createdAt
        self.resolvedAt = resolvedAt
    }

    public var isPending: Bool {
        status == .pending
    }
}
