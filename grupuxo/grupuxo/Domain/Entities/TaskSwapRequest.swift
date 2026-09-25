//
//  TaskSwapRequest.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

enum TaskSwapRequestStatus: String, Codable, Sendable {
    case pending
    case accepted
    case rejected
}

struct TaskSwapRequest: Identifiable, Hashable, Codable, Sendable {

    let id: UUID

    let requesterID: User.ID
    let receiverID: User.ID

    let offeredOccurrenceID: TaskOccurrence.ID
    let requestedOccurrenceID: TaskOccurrence.ID

    var status: TaskSwapRequestStatus

    let createdAt: Date
    var resolvedAt: Date?

    var isPending: Bool {
        status == .pending
    }
}
