//
//  MarkNotificationAsReadUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

public struct MarkNotificationAsReadUseCase: Sendable {

    public let repository: any NotificationRepository

    public init(repository: any NotificationRepository) {
        self.repository = repository
    }

    public func callAsFunction(
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
