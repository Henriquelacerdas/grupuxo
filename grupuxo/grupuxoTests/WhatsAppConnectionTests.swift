import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

struct WhatsAppConnectionTests {
    private let linked = WhatsAppConnection(maskedPhone: "+55•••••••8888", linkedAt: Date(timeIntervalSince1970: 1_700_000_000))

    @Test func invitationDoesNotConnectUntilTheLinkIsUsed() async throws {
        let repository = MockWhatsAppConnectionRepository()
        #expect(try await repository.connection() == nil)
        let invitation = try await CreateWhatsAppInvitationUseCase(repository: repository)()
        #expect(invitation.url.host == "wa.me")
        #expect(invitation.url.absoluteString.contains("Reveza"))
        // Primeira leitura depois do convite: o mock simula o envio da mensagem no WhatsApp.
        let connection = try #require(try await GetWhatsAppConnectionUseCase(repository: repository)())
        #expect(connection.maskedPhone.contains("•"))
        #expect(try await repository.connection() == connection)
    }

    @Test func secondInvitationWhileLinkedIsRejected() async throws {
        let repository = MockWhatsAppConnectionRepository(linked: linked)
        await #expect(throws: WhatsAppConnectionError.alreadyLinked) {
            try await CreateWhatsAppInvitationUseCase(repository: repository)()
        }
    }

    @Test func disconnectIsIdempotent() async throws {
        let repository = MockWhatsAppConnectionRepository(linked: linked)
        let disconnect = DisconnectWhatsAppUseCase(repository: repository)
        try await disconnect()
        try await disconnect()
        #expect(try await repository.connection() == nil)
    }

    @MainActor
    @Test func viewModelLoadsConnectsAndDisconnects() async throws {
        let repository = MockWhatsAppConnectionRepository()
        let viewModel = makeViewModel(repository)
        await viewModel.load()
        #expect(viewModel.state == .notConnected)

        let url = try #require(await viewModel.connect())
        #expect(url.host == "wa.me")
        #expect(viewModel.state == .notConnected, "conectar só abre o link; o estado muda depois do envio")
        await viewModel.load()
        guard case .connected = viewModel.state else { Issue.record("esperava conectado"); return }

        await viewModel.disconnectNumber()
        #expect(viewModel.state == .notConnected)
        #expect(viewModel.actionError == nil)
    }

    @MainActor
    @Test func viewModelShowsErrorsWithoutLosingState() async throws {
        let viewModel = makeViewModel(FailingRepository())
        await viewModel.load()
        #expect(viewModel.state == .failed(WhatsAppConnectionError.unavailable.localizedDescription))
        #expect(await viewModel.connect() == nil)
        #expect(viewModel.actionError == WhatsAppConnectionError.unavailable.localizedDescription)
    }

    @MainActor
    @Test func alreadyLinkedOnConnectRefreshesState() async throws {
        let viewModel = makeViewModel(MockWhatsAppConnectionRepository(linked: linked))
        #expect(await viewModel.connect() == nil)
        #expect(viewModel.actionError == WhatsAppConnectionError.alreadyLinked.localizedDescription)
        #expect(viewModel.state == .connected(linked))
    }

    @MainActor
    private func makeViewModel(_ repository: any WhatsAppConnectionRepository) -> WhatsAppConnectionViewModel {
        WhatsAppConnectionViewModel(
            getConnection: GetWhatsAppConnectionUseCase(repository: repository),
            createInvitation: CreateWhatsAppInvitationUseCase(repository: repository),
            disconnect: DisconnectWhatsAppUseCase(repository: repository)
        )
    }
}

private struct FailingRepository: WhatsAppConnectionRepository {
    func connection() async throws -> WhatsAppConnection? { throw WhatsAppConnectionError.unavailable }
    func createInvitation() async throws -> WhatsAppInvitation { throw WhatsAppConnectionError.unavailable }
    func disconnect() async throws { throw WhatsAppConnectionError.unavailable }
}
