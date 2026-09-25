//
//  MarkNotificationAsReadUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

struct MarkNotificationAsReadUseCase: Sendable {

    let repository: any NotificationRepository

    func callAsFunction(
        notificationID: AppNotification.ID,
        userID: User.ID,
        date: Date = .now
    ) async throws {

        try await repository.markAsRead(
            notificationID: notificationID,
            by: userID,
            at: date
        )
    }
}
