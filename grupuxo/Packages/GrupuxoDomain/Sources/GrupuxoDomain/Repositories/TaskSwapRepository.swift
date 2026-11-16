//
//  TaskSwapRepository.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public protocol TaskSwapRepository: Sendable {

    func swapCandidates(
        for requesterID: User.ID,
        offering offeredOccurrenceID: TaskOccurrence.ID,
        in houseID: House.ID,
        at date: Date
    ) async throws -> [TaskItem]

    func createRequest(
        requesterID: User.ID,
        offeredOccurrenceID: TaskOccurrence.ID,
        requestedOccurrenceID: TaskOccurrence.ID,
        at date: Date
    ) async throws -> TaskSwapRequest

    func incomingRequests(
        for userID: User.ID,
        in houseID: House.ID
    ) async throws -> [TaskSwapRequest]

    func outgoingRequests(
        for userID: User.ID,
        in houseID: House.ID
    ) async throws -> [TaskSwapRequest]

    func accept(
        requestID: TaskSwapRequest.ID,
        by userID: User.ID,
        at date: Date
    ) async throws -> TaskSwapRequest

    func reject(
        requestID: TaskSwapRequest.ID,
        by userID: User.ID,
        at date: Date
    ) async throws -> TaskSwapRequest

    /// Só quem pediu e só enquanto pendente; a outra pessoa deixa de ver o pedido.
    func cancel(
        requestID: TaskSwapRequest.ID,
        by userID: User.ID,
        at date: Date
    ) async throws -> TaskSwapRequest
}
