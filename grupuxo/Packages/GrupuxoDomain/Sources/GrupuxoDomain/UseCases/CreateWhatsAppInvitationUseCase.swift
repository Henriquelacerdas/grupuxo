public struct CreateWhatsAppInvitationUseCase: Sendable {
    public let repository: any WhatsAppConnectionRepository

    public init(repository: any WhatsAppConnectionRepository) {
        self.repository = repository
    }

    public func callAsFunction() async throws -> WhatsAppInvitation {
        try await repository.createInvitation()
    }
}
