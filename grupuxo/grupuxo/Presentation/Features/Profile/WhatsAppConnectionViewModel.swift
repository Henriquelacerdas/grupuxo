import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class WhatsAppConnectionViewModel: ObservableObject {
    @Published private(set) var state: WhatsAppConnectionState = .idle
    @Published private(set) var isWorking = false
    @Published var actionError: String?

    private let getConnection: GetWhatsAppConnectionUseCase
    private let createInvitation: CreateWhatsAppInvitationUseCase
    private let disconnect: DisconnectWhatsAppUseCase

    init(
        getConnection: GetWhatsAppConnectionUseCase,
        createInvitation: CreateWhatsAppInvitationUseCase,
        disconnect: DisconnectWhatsAppUseCase
    ) {
        self.getConnection = getConnection
        self.createInvitation = createInvitation
        self.disconnect = disconnect
    }

    func load() async {
        // Recarregar não esconde o estado atual atrás de um indicador: só a primeira carga mostra "Carregando".
        if case .idle = state { state = .loading }
        do {
            if let connection = try await getConnection() {
                state = .connected(connection)
            } else {
                state = .notConnected
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Gera o convite e devolve o link `wa.me` para a View abrir. O número só passa a constar como conectado depois
    /// que o morador envia a mensagem no WhatsApp; `load()` ao voltar para o app mostra o novo estado.
    func connect() async -> URL? {
        guard !isWorking else { return nil }
        isWorking = true
        actionError = nil
        defer { isWorking = false }
        do {
            return try await createInvitation().url
        } catch WhatsAppConnectionError.alreadyLinked {
            actionError = WhatsAppConnectionError.alreadyLinked.localizedDescription
            await load()
            return nil
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    func disconnectNumber() async {
        guard !isWorking else { return }
        isWorking = true
        actionError = nil
        defer { isWorking = false }
        do {
            try await disconnect()
            state = .notConnected
        } catch {
            actionError = error.localizedDescription
        }
    }
}
