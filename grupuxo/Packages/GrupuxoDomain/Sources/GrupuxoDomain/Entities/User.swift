import Foundation

public struct User: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public var name: String
    public var email: String?
    /// Foto do perfil (URL de leitura do servidor); `nil` = sem foto, o avatar mostra as iniciais.
    public var photoURL: URL?

    public init(
        id: UUID,
        name: String,
        email: String?,
        photoURL: URL? = nil
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.photoURL = photoURL
    }
}
