//
//  NotificationRepository.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

import Foundation

protocol NotificationRepository: Sendable {

    func notifications(
        for userID: User.ID
    ) async throws -> [AppNotification]

    func markAsRead(
        notificationID: AppNotification.ID,
        by userID: User.ID,
        at date: Date
    ) async throws
}
