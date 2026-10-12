import GrupuxoDomain

enum WhatsAppConnectionState: Equatable {
    case idle
    case loading
    case notConnected
    case connected(WhatsAppConnection)
    case failed(String)
}
