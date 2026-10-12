public struct GetWhatsAppConnectionUseCase: Sendable {
    public let repository: any WhatsAppConnectionRepository

    public init(repository: any WhatsAppConnectionRepository) {
        self.repository = repository
    }

    public func callAsFunction() async throws -> WhatsAppConnection? {
        try await repository.connection()
    }
}
