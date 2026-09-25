//
//  MockTaskSwapRepository.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct MockTaskSwapRepository: TaskSwapRepository {

    let store: MockStore
    let eligibilityPolicy: TaskSwapEligibilityPolicy

    init(
        store: MockStore,
        eligibilityPolicy: TaskSwapEligibilityPolicy = TaskSwapEligibilityPolicy()
    ) {
        self.store = store
        self.eligibilityPolicy = eligibilityPolicy
    }

    func swapCandidates(
        for requesterID: User.ID,
        offering offeredOccurrenceID: TaskOccurrence.ID,
        in houseID: House.ID,
        at date: Date
    ) async throws -> [TaskItem] {

        try await store.read { state in

            guard state.houseMemberships.contains(
                where: {
                    $0.houseID == houseID
                        && $0.userID == requesterID
                }
            ) else {
                throw DomainError.taskUnavailable
            }

            guard
                let offeredItem = item(
                    occurrenceID: offeredOccurrenceID,
                    from: state
                ),
                let offeredRoom = room(
                    for: offeredItem,
                    from: state
                ),
                offeredRoom.houseID == houseID
            else {
                throw DomainError.entityNotFound
            }

            guard eligibilityPolicy.canOffer(
                offeredItem,
                by: requesterID,
                at: date
            ) else {
                throw DomainError.taskUnavailable
            }

            return items(from: state)
                .filter { candidate in

                    guard
                        let assignment = candidate.assignment,
                        assignment.userID != requesterID,
                        assignment.isActive,
                        let requestedRoom = room(
                            for: candidate,
                            from: state
                        ),
                        requestedRoom.houseID == houseID
                    else {
                        return false
                    }

                    return eligibilityPolicy.canSwap(
                        offeredItem: offeredItem,
                        requestedItem: candidate,
                        offeredRoom: offeredRoom,
                        requestedRoom: requestedRoom,
                        requesterID: requesterID,
                        receiverID: assignment.userID,
                        houseMemberships: state.houseMemberships,
                        roomMemberships: state.roomMemberships,
                        absences: state.absences,
                        at: date
                    )
                }
                .sortedByDeadline()
        }
    }

    func createRequest(
        requesterID: User.ID,
        offeredOccurrenceID: TaskOccurrence.ID,
        requestedOccurrenceID: TaskOccurrence.ID,
        at date: Date
    ) async throws -> TaskSwapRequest {

        try await store.update { state in

            guard
                let offeredItem = item(
                    occurrenceID: offeredOccurrenceID,
                    from: state
                ),
                let requestedItem = item(
                    occurrenceID: requestedOccurrenceID,
                    from: state
                ),
                let offeredAssignment = offeredItem.assignment,
                let requestedAssignment = requestedItem.assignment,
                let offeredRoom = room(
                    for: offeredItem,
                    from: state
                ),
                let requestedRoom = room(
                    for: requestedItem,
                    from: state
                )
            else {
                throw DomainError.entityNotFound
            }

            let receiverID = requestedAssignment.userID

            guard offeredRoom.houseID == requestedRoom.houseID else {
                throw DomainError.taskUnavailable
            }

            guard eligibilityPolicy.canSwap(
                offeredItem: offeredItem,
                requestedItem: requestedItem,
                offeredRoom: offeredRoom,
                requestedRoom: requestedRoom,
                requesterID: requesterID,
                receiverID: receiverID,
                houseMemberships: state.houseMemberships,
                roomMemberships: state.roomMemberships,
                absences: state.absences,
                at: date
            ) else {
                throw DomainError.taskUnavailable
            }

            guard offeredAssignment.userID == requesterID else {
                throw DomainError.taskUnavailable
            }

            let alreadyExists = state.taskSwapRequests.contains {
                $0.requesterID == requesterID
                    && $0.receiverID == receiverID
                    && $0.offeredOccurrenceID == offeredOccurrenceID
                    && $0.requestedOccurrenceID == requestedOccurrenceID
                    && $0.status == .pending
            }

            guard !alreadyExists else {
                throw DomainError.taskUnavailable
            }

            let request = TaskSwapRequest(
                id: UUID(),
                requesterID: requesterID,
                receiverID: receiverID,
                offeredOccurrenceID: offeredOccurrenceID,
                requestedOccurrenceID: requestedOccurrenceID,
                status: .pending,
                createdAt: date,
                resolvedAt: nil
            )

            state.taskSwapRequests.append(request)

            state.notifications.append(
                AppNotification(
                    id: UUID(),
                    recipientUserID: receiverID,
                    kind: .taskSwapRequested,
                    swapRequestID: request.id,
                    createdAt: date,
                    readAt: nil
                )
            )

            return request
        }
    }

    func incomingRequests(
        for userID: User.ID,
        in houseID: House.ID
    ) async throws -> [TaskSwapRequest] {

        await store.read { state in

            state.taskSwapRequests
                .filter {
                    $0.receiverID == userID
                        && belongsToHouse(
                            $0,
                            houseID: houseID,
                            state: state
                        )
                }
                .sorted {
                    $0.createdAt > $1.createdAt
                }
        }
    }

    func outgoingRequests(
        for userID: User.ID,
        in houseID: House.ID
    ) async throws -> [TaskSwapRequest] {

        await store.read { state in

            state.taskSwapRequests
                .filter {
                    $0.requesterID == userID
                        && belongsToHouse(
                            $0,
                            houseID: houseID,
                            state: state
                        )
                }
                .sorted {
                    $0.createdAt > $1.createdAt
                }
        }
    }

    func accept(
        requestID: TaskSwapRequest.ID,
        by userID: User.ID,
        at date: Date
    ) async throws -> TaskSwapRequest {

        try await store.update { state in

            guard let requestIndex = state.taskSwapRequests.firstIndex(
                where: {
                    $0.id == requestID
                }
            ) else {
                throw DomainError.entityNotFound
            }

            let request = state.taskSwapRequests[requestIndex]

            guard
                request.status == .pending,
                request.receiverID == userID
            else {
                throw DomainError.taskUnavailable
            }

            guard
                let offeredItem = item(
                    occurrenceID: request.offeredOccurrenceID,
                    from: state
                ),
                let requestedItem = item(
                    occurrenceID: request.requestedOccurrenceID,
                    from: state
                ),
                let offeredRoom = room(
                    for: offeredItem,
                    from: state
                ),
                let requestedRoom = room(
                    for: requestedItem,
                    from: state
                )
            else {
                throw DomainError.entityNotFound
            }

            guard eligibilityPolicy.canSwap(
                offeredItem: offeredItem,
                requestedItem: requestedItem,
                offeredRoom: offeredRoom,
                requestedRoom: requestedRoom,
                requesterID: request.requesterID,
                receiverID: request.receiverID,
                houseMemberships: state.houseMemberships,
                roomMemberships: state.roomMemberships,
                absences: state.absences,
                at: date
            ) else {
                throw DomainError.taskUnavailable
            }

            guard
                let offeredAssignmentIndex = state.assignments.firstIndex(
                    where: {
                        $0.occurrenceID == request.offeredOccurrenceID
                            && $0.userID == request.requesterID
                            && $0.isActive
                    }
                ),
                let requestedAssignmentIndex = state.assignments.firstIndex(
                    where: {
                        $0.occurrenceID == request.requestedOccurrenceID
                            && $0.userID == request.receiverID
                            && $0.isActive
                    }
                )
            else {
                throw DomainError.taskUnavailable
            }

            state.assignments[offeredAssignmentIndex].endedAt = date
            state.assignments[requestedAssignmentIndex].endedAt = date

            state.assignments.append(
                TaskAssignment(
                    id: UUID(),
                    occurrenceID: request.offeredOccurrenceID,
                    userID: request.receiverID,
                    assignedAt: date,
                    endedAt: nil
                )
            )

            state.assignments.append(
                TaskAssignment(
                    id: UUID(),
                    occurrenceID: request.requestedOccurrenceID,
                    userID: request.requesterID,
                    assignedAt: date,
                    endedAt: nil
                )
            )

            state.taskSwapRequests[requestIndex].status = .accepted
            state.taskSwapRequests[requestIndex].resolvedAt = date

            let updatedRequest = state.taskSwapRequests[requestIndex]

            state.notifications.append(
                AppNotification(
                    id: UUID(),
                    recipientUserID: request.requesterID,
                    kind: .taskSwapAccepted,
                    swapRequestID: request.id,
                    createdAt: date,
                    readAt: nil
                )
            )

            return updatedRequest
        }
    }

    func reject(
        requestID: TaskSwapRequest.ID,
        by userID: User.ID,
        at date: Date
    ) async throws -> TaskSwapRequest {

        try await store.update { state in

            guard let requestIndex = state.taskSwapRequests.firstIndex(
                where: {
                    $0.id == requestID
                }
            ) else {
                throw DomainError.entityNotFound
            }

            let request = state.taskSwapRequests[requestIndex]

            guard
                request.status == .pending,
                request.receiverID == userID
            else {
                throw DomainError.taskUnavailable
            }

            state.taskSwapRequests[requestIndex].status = .rejected
            state.taskSwapRequests[requestIndex].resolvedAt = date

            let updatedRequest = state.taskSwapRequests[requestIndex]

            state.notifications.append(
                AppNotification(
                    id: UUID(),
                    recipientUserID: request.requesterID,
                    kind: .taskSwapRejected,
                    swapRequestID: request.id,
                    createdAt: date,
                    readAt: nil
                )
            )

            return updatedRequest
        }
    }

    private nonisolated func items(
        from state: MockStore.State
    ) -> [TaskItem] {

        let definitionsByID = Dictionary(
            uniqueKeysWithValues:
                state.definitions.map {
                    ($0.id, $0)
                }
        )

        return state.occurrences.compactMap { occurrence in

            guard let definition = definitionsByID[
                occurrence.taskDefinitionID
            ] else {
                return nil
            }

            let assignment = state.assignments.first {
                $0.occurrenceID == occurrence.id
                    && $0.isActive
            }

            let assignee = assignment.flatMap { assignment in
                state.users.first {
                    $0.id == assignment.userID
                }
            }

            return TaskItem(
                definition: definition,
                occurrence: occurrence,
                assignment: assignment,
                assignee: assignee
            )
        }
    }

    private nonisolated func item(
        occurrenceID: TaskOccurrence.ID,
        from state: MockStore.State
    ) -> TaskItem? {

        items(from: state).first {
            $0.id == occurrenceID
        }
    }

    private nonisolated func room(
        for item: TaskItem,
        from state: MockStore.State
    ) -> Room? {

        state.rooms.first {
            $0.id == item.definition.roomID
        }
    }

    private nonisolated func belongsToHouse(
        _ request: TaskSwapRequest,
        houseID: House.ID,
        state: MockStore.State
    ) -> Bool {

        guard
            let offeredItem = item(
                occurrenceID: request.offeredOccurrenceID,
                from: state
            ),
            let offeredRoom = room(
                for: offeredItem,
                from: state
            )
        else {
            return false
        }

        return offeredRoom.houseID == houseID
    }
}
