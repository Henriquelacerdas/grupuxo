//
//  NotificationsViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Combine
import Foundation

@MainActor
final class NotificationsViewModel: ObservableObject {

    @Published private(set)
    var state: NotificationsState = .idle

    @Published var actionError: String?

    private let getNotifications: GetNotificationsUseCase

    private let markNotificationAsRead:
        MarkNotificationAsReadUseCase

    private let userID: User.ID

    init(
        getNotifications: GetNotificationsUseCase,
        markNotificationAsRead: MarkNotificationAsReadUseCase,
        userID: User.ID
    ) {

        self.getNotifications =
            getNotifications

        self.markNotificationAsRead =
            markNotificationAsRead

        self.userID =
            userID

    }

    func load() async {

        state = .loading

        do {

            let notifications =
                try await getNotifications(
                    userID: userID
                )

            state = notifications.isEmpty
                ? .empty
                : .content(notifications)

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

}
