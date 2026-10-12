public struct DisconnectWhatsAppUseCase: Sendable {
    public let repository: any WhatsAppConnectionRepository

    public init(repository: any WhatsAppConnectionRepository) {
        self.repository = repository
    }

    public func callAsFunction() async throws {
        try await repository.disconnect()
    }
}
