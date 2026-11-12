//
//  ShortcutBackend.swift
//  grupuxo
//

import Foundation
import GrupuxoDomain

/// Monta container e sessão sem passar pela interface, para os atalhos funcionarem
/// com o app fechado (sem abrir telas).
@MainActor
enum ShortcutBackend {

    struct Context {
        let container: AppContainer
        let session: AppSession
    }

    private static var cached: Context?

    /// `refresh: true` ignora o contexto em memória e confirma quem está logado agora.
    static func context(refresh: Bool = false) async throws -> Context {
        if !refresh, let cached { return cached }

        do {
            let configuration = try APIConfiguration()
            let api = APIClient(
                baseURL: configuration.baseURL,
                tokens: AmplifyAccessTokenProvider()
            )
            let cache = MyHouseCache(api: api, prefersSnapshot: true)

            let account = try await api.get(RegisteredAccountDTO.self, "v1/me")
            let home = try await cache.myHouse()

            let name = home.members.first { $0.id == account.id }?.name ?? ""
            let user = User(id: account.id, name: name, email: nil)

            let context = Context(
                container: AppContainer(api: api, myHouse: cache),
                session: AppSession(
                    currentUser: user,
                    currentHouse: home.house.domain
                )
            )
            cached = context
            return context

        } catch let error as APIError where error == .unauthorized {
            throw ShortcutError.notSignedIn
        } catch let error as APIError
                    where error.code == "no_house" || error.code == "account_not_registered" {
            throw ShortcutError.noHouse
        }
    }
}

extension ShortcutBackend {

    /// Cômodos em que a pessoa participa (os mesmos do formulário de tarefa).
    static func loadRooms() async throws -> [Room] {
        let context = try await context()
        return try await context.container.makeGetHouseRoomsUseCase()(
            houseID: context.session.currentHouse.id,
            userID: context.session.currentUser.id,
            participatingOnly: true
        )
    }
}

enum ShortcutError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case noHouse
    case roomNotFound
    case saveFailed(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn:
            "Abra o app e entre na sua conta."
        case .noHouse:
            "Você ainda não participa de uma casa."
        case .roomNotFound:
            "Não encontrei esse cômodo."
        case let .saveFailed(message):
            "Não foi possível criar a tarefa: \(message)"
        }
    }
}
