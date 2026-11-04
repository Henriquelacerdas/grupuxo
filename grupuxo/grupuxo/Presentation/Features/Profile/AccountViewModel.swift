import Combine
import Foundation

/// Dados de login da tela Conta (e-mail e provedor). O nome vem da sessão da casa.
@MainActor
final class AccountViewModel: ObservableObject {

    @Published private(set) var identity: AccountIdentity?

    private let reader: any AccountIdentityReading

    init(reader: any AccountIdentityReading) {
        self.reader = reader
    }

    func load() async {
        identity = await reader.identity()
    }
}
