//
//   MockNotificationRepository.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct MockNotificationRepository: NotificationRepository {

    let store: MockStore

    func notifications(
        for userID: User.ID
    ) async throws -> [AppNotification] {

        await store.read { state in
            state.notifications
                .filter {
                    $0.recipientUserID == userID
                }
                .sorted {
                    $0.createdAt > $1.createdAt
                }
        }
    }

    func markAsRead(
        notificationID: AppNotification.ID,
        by userID: User.ID,
        at date: Date
    ) async throws {

        try await store.update { state in

            guard let index = state.notifications.firstIndex(
                where: {
                    $0.id == notificationID
                        && $0.recipientUserID == userID
                }
            ) else {
                throw DomainError.entityNotFound
            }

            guard state.notifications[index].readAt == nil else {
                return
            }

            state.notifications[index].readAt = date
        }
    }
}
