//
//  GetNotificationsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

public struct GetNotificationsUseCase: Sendable {

    public let repository: any NotificationRepository

    public init(repository: any NotificationRepository) {
        self.repository = repository
    }

    public func callAsFunction(
        userID: User.ID
    ) async throws -> [AppNotification] {

        try await repository.notifications(
            for: userID
        )
    }
}
