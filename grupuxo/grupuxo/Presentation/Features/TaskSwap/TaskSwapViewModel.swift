//
//  TaskSwapViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//
import Combine
import Foundation

@MainActor
final class TaskSwapViewModel: ObservableObject {

    @Published private(set) var state: TaskSwapState = .idle
    @Published private(set) var isSending = false

    private let getMyTasks: GetMyTasksUseCase
    private let getCandidates: GetTaskSwapCandidatesUseCase
    private let createRequest: CreateTaskSwapRequestUseCase

    private let userID: User.ID
    private let houseID: House.ID
    private let offeredOccurrenceID: TaskOccurrence.ID

    init(
        getMyTasks: GetMyTasksUseCase,
        getCandidates: GetTaskSwapCandidatesUseCase,
        createRequest: CreateTaskSwapRequestUseCase,
        userID: User.ID,
        houseID: House.ID,
        offeredOccurrenceID: TaskOccurrence.ID
    ) {
        self.getMyTasks = getMyTasks
        self.getCandidates = getCandidates
        self.createRequest = createRequest
        self.userID = userID
        self.houseID = houseID
        self.offeredOccurrenceID = offeredOccurrenceID
    }

    func load() async {
        state = .loading

        do {
            let myTasks = try await getMyTasks(
                userID: userID,
                houseID: houseID
            )

            guard let offeredTask = myTasks.first(
                where: {
                    $0.id == offeredOccurrenceID
                }
            ) else {
                state = .failure(
                    "A tarefa oferecida não está mais disponível."
                )
                return
            }

            let candidates = try await getCandidates(
                requesterID: userID,
                offeredOccurrenceID: offeredOccurrenceID,
                houseID: houseID
            )

            state = .content(
                offeredTask: offeredTask,
                candidates: candidates
            )

        } catch {
            state = .failure(
                error.localizedDescription
            )
        }
    }

    func requestSwap(
        requestedOccurrenceID: TaskOccurrence.ID
    ) async {

        guard !isSending else {
            return
        }

        isSending = true
        defer {
            isSending = false
        }

        do {
            _ = try await createRequest(
                requesterID: userID,
                offeredOccurrenceID: offeredOccurrenceID,
                requestedOccurrenceID: requestedOccurrenceID
            )

            state = .sent

        } catch {
            state = .failure(
                error.localizedDescription
            )
        }
    }
}
