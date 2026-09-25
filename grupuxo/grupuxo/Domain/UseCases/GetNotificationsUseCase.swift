//
//  GetNotificationsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

struct GetNotificationsUseCase: Sendable {

    let repository: any NotificationRepository

    func callAsFunction(
        userID: User.ID
    ) async throws -> [AppNotification] {

        try await repository.notifications(
            for: userID
        )
    }
}
