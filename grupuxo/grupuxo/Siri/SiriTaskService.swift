import Foundation
import GrupuxoDomain
import os

/// Tarefa pendente do morador como a Siri, os Atalhos e o Spotlight a enxergam.
struct SiriTask: Sendable, Hashable {
    let occurrenceID: TaskOccurrence.ID
    let name: String
    let dueAt: Date?
}

/// Ponte entre os App Intents e os casos de uso do domínio (Intent → UseCase → Repository → API).
///
/// Os intents rodam dentro do processo do app e não têm a `RemoteHouseSession` da interface: este serviço
/// monta o próprio `APIClient` (token do Cognito pelo Amplify) e descobre usuário e casa por `GET /v1/me/house/snapshot`.
/// O `userID` vem sempre do servidor (token), nunca da fala do usuário.
final class SiriTaskService: Sendable {

    enum ServiceError: Error, CustomLocalizedStringResourceConvertible {
        case notConfigured
        case notSignedIn
        case noHouse
        case unavailable
        case taskNotFound

        var localizedStringResource: LocalizedStringResource {
            switch self {
            case .notConfigured: "O servidor do app não está configurado neste build."
            case .notSignedIn: "Abra o app e entre na sua conta para usar a Siri."
            case .noHouse: "Você ainda não faz parte de uma casa."
            case .unavailable: "Não foi possível falar com o servidor agora. Tente de novo em instantes."
            case .taskNotFound: "Não encontrei essa tarefa entre as suas pendentes."
            }
        }
    }

    private let api: APIClient?
    private let cache: MyHouseCache?

    init(api: APIClient?) {
        self.api = api
        self.cache = api.map { MyHouseCache(api: $0, prefersSnapshot: true) }
    }

    /// Falha fechado como o app: sem `GRUPUXO_API_BASE_URL` válido, nenhum intent fala com servidor algum.
    static func make() -> SiriTaskService {
        guard let configuration = try? APIConfiguration() else { return SiriTaskService(api: nil) }
        return SiriTaskService(api: APIClient(baseURL: configuration.baseURL, tokens: AmplifyAccessTokenProvider()))
    }

    /// Tarefas ainda não concluídas do morador, na ordem de prazo.
    func pendingTasks() async throws -> [SiriTask] {
        let context = try await loadContext()
        let items = try await translate {
            try await GetMyTasksUseCase(repository: context.repository)(userID: context.userID, houseID: context.houseID)
        }
        return items
            .filter { !$0.occurrence.isCompleted }
            .map { SiriTask(occurrenceID: $0.occurrence.id, name: $0.definition.name, dueAt: $0.occurrence.dueAt) }
    }

    func pendingTasks(matching text: String) async throws -> [SiriTask] {
        let query = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return try await pendingTasks().filter {
            $0.name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).contains(query)
        }
    }

    func pendingTasks(withIDs ids: [TaskOccurrence.ID]) async throws -> [SiriTask] {
        try await pendingTasks().filter { ids.contains($0.occurrenceID) }
    }

    func complete(occurrenceID: TaskOccurrence.ID) async throws {
        let context = try await loadContext()
        try await translate {
            try await CompleteTaskUseCase(repository: context.repository)(occurrenceID: occurrenceID, userID: context.userID)
        }
        await cache?.invalidate()
    }

    // MARK: - Privado

    private struct Context {
        let userID: User.ID
        let houseID: House.ID
        let repository: any TaskRepository
    }

    private func loadContext() async throws -> Context {
        guard let api, let cache else { throw ServiceError.notConfigured }
        let identity: (userID: User.ID, houseID: House.ID) = try await translate {
            if let snapshot = try await cache.snapshot() {
                return (snapshot.userID, snapshot.home.house.id)
            }
            // Servidor sem a rota de snapshot: mesmo caminho do `RemoteHouseSession`.
            let account = try await api.get(RegisteredAccountDTO.self, "v1/me")
            let home = try await cache.myHouse()
            return (account.id, home.house.id)
        }
        return Context(
            userID: identity.userID,
            houseID: identity.houseID,
            repository: RemoteTaskRepository(api: api, myHouse: cache)
        )
    }

    private func translate<Value: Sendable>(_ work: () async throws -> Value) async throws -> Value {
        do {
            return try await work()
        } catch let error as APIError {
            Logger(subsystem: "vidal.grupuxo", category: "Siri").error("API falhou: \(String(describing: error), privacy: .public)")
            switch error {
            case .unauthorized: throw ServiceError.notSignedIn
            case .http where error.code == "no_house" || error.code == "account_not_registered": throw ServiceError.noHouse
            default: throw ServiceError.unavailable
            }
        }
    }
}
