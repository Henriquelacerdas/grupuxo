//
//  NotificationsViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class NotificationsViewModel: ObservableObject {

    @Published private(set)
    var state: NotificationsState = .idle

    @Published var actionError: String?

    /// Pedido de troca sendo respondido agora (desabilita os botões dele).
    @Published private(set)
    var respondingSwapID: TaskSwapRequest.ID?

    private let getNotifications: GetNotificationsUseCase

    private let markNotificationAsRead:
        MarkNotificationAsReadUseCase

    private let getIncomingSwaps:
        GetIncomingTaskSwapRequestsUseCase

    private let acceptSwap: AcceptTaskSwapRequestUseCase

    private let rejectSwap: RejectTaskSwapRequestUseCase

    private let getMyTasks: GetMyTasksUseCase

    private let getSwapCandidates: GetTaskSwapCandidatesUseCase

    private let getMembers: GetHouseMembersUseCase

    private let userID: User.ID

    private let houseID: House.ID

    init(
        getNotifications: GetNotificationsUseCase,
        markNotificationAsRead: MarkNotificationAsReadUseCase,
        getIncomingSwaps: GetIncomingTaskSwapRequestsUseCase,
        acceptSwap: AcceptTaskSwapRequestUseCase,
        rejectSwap: RejectTaskSwapRequestUseCase,
        getMyTasks: GetMyTasksUseCase,
        getSwapCandidates: GetTaskSwapCandidatesUseCase,
        getMembers: GetHouseMembersUseCase,
        userID: User.ID,
        houseID: House.ID
    ) {

        self.getNotifications =
            getNotifications

        self.markNotificationAsRead =
            markNotificationAsRead

        self.getIncomingSwaps =
            getIncomingSwaps

        self.acceptSwap =
            acceptSwap

        self.rejectSwap =
            rejectSwap

        self.getMyTasks =
            getMyTasks

        self.getSwapCandidates =
            getSwapCandidates

        self.getMembers =
            getMembers

        self.userID =
            userID

        self.houseID =
            houseID

    }

    func load() async {

        state = .loading

        do {

            let notifications =
                try await getNotifications(
                    userID: userID
                )

            let pendingSwaps =
                try await loadPendingSwaps()

            state = notifications.isEmpty
                && pendingSwaps.isEmpty
                ? .empty
                : .content(
                    notifications: notifications,
                    pendingSwaps: pendingSwaps
                )

        } catch is CancellationError {
            // A tela saiu antes da resposta.
        } catch {

            state = .failure(
                error.localizedDescription
            )

        }

    }

    func markAsRead(
        _ notification: AppNotification
    ) async {

        guard !notification.isRead else {
            return
        }

        do {

            try await markNotificationAsRead(
                notificationID:
                    notification.id,
                userID: userID
            )

            await load()

        } catch {

            actionError =
                error.localizedDescription

        }

    }

    func accept(
        _ swap: IncomingSwapRequest
    ) async {

        await respond(to: swap) {
            requestID, userID in

            _ = try await self.acceptSwap(
                requestID: requestID,
                userID: userID
            )

        }

    }

    func reject(
        _ swap: IncomingSwapRequest
    ) async {

        await respond(to: swap) {
            requestID, userID in

            _ = try await self.rejectSwap(
                requestID: requestID,
                userID: userID
            )

        }

    }

    private func respond(
        to swap: IncomingSwapRequest,
        action: (TaskSwapRequest.ID, User.ID) async throws -> Void
    ) async {

        guard respondingSwapID == nil else {
            return
        }

        respondingSwapID = swap.id

        defer {
            respondingSwapID = nil
        }

        do {

            try await action(
                swap.id,
                userID
            )

        } catch {

            actionError =
                error.localizedDescription

        }

        // Recarrega também na falha: o pedido pode ter sido resolvido por outro caminho.
        await load()

    }

    private func loadPendingSwaps() async throws -> [IncomingSwapRequest] {

        let requests =
            try await getIncomingSwaps(
                userID: userID,
                houseID: houseID
            )
            .filter(\.isPending)

        guard !requests.isEmpty else {
            return []
        }

        // Nomes são só para exibir: se a busca falhar, a tela mostra um texto genérico.
        let myTasks =
            (try? await getMyTasks(
                userID: userID,
                houseID: houseID
            )) ?? []

        let members =
            (try? await getMembers(
                houseID: houseID,
                userID: userID
            )) ?? []

        var result: [IncomingSwapRequest] = []

        for request in requests {

            result.append(
                IncomingSwapRequest(
                    request: request,
                    requesterName:
                        members.first {
                            $0.id == request.requesterID
                        }?.name,
                    offeredTaskName:
                        await offeredTaskName(
                            for: request
                        ),
                    requestedTaskName:
                        myTasks.first {
                            $0.id == request.requestedOccurrenceID
                        }?.definition.name
                )
            )

        }

        return result

    }

    /// A tarefa oferecida é de quem pediu e não está em "minhas tarefas". A elegibilidade da troca
    /// é simétrica, então ela aparece entre as candidatas para trocar pela tarefa que me pediram.
    private func offeredTaskName(
        for request: TaskSwapRequest
    ) async -> String? {

        let candidates =
            (try? await getSwapCandidates(
                requesterID: userID,
                offeredOccurrenceID:
                    request.requestedOccurrenceID,
                houseID: houseID
            )) ?? []

        return candidates.first {
            $0.id == request.offeredOccurrenceID
        }?.definition.name

    }

}
