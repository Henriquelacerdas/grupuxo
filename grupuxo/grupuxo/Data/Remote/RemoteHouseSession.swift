import Combine
import Foundation
import GrupuxoDomain

/// Estado da casa do morador logado, vindo da `api` (substitui o `HouseService` do Amplify Data).
///
/// A composição do app abre por `GET /v1/me/house/snapshot`: identidade e dados das telas numa resposta.
/// Servidor anterior: `GET /v1/me` → `GET /v1/me/house`. Sem conta/casa, mostra onboarding.
/// Criar e entrar registram a conta antes (`POST /v1/me`) com o nome digitado no onboarding.
@MainActor
final class RemoteHouseSession: ObservableObject {

    struct Home: Equatable {
        let house: House
        let members: [User]
        let rooms: [Room]
    }

    enum LoadError: Equatable {
        /// A sessão acabou: o app volta ao login.
        case sessionExpired
        case failed(String)

        var message: String {
            switch self {
            case .sessionExpired: String(localized: "Sua sessão expirou. Entre novamente.")
            case .failed(let message): message
            }
        }
    }

    @Published private(set) var home: Home?
    @Published private(set) var me: User?
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoaded = false
    @Published var errorMessage: String?
    @Published private(set) var loadError: LoadError?
    /// Sair apagaria cômodos em que o morador é o último participante: a tela pede confirmação e repete.
    @Published var leaveNeedsConfirmation = false
    /// O morador é o último da casa: sair exclui a casa inteira. A tela pede confirmação e repete.
    @Published var leaveNeedsHouseDeletionConfirmation = false

    /// `nil` quando o build não tem endereço de servidor (`GRUPUXO_API_BASE_URL`): o app mostra o erro em vez de tentar.
    let api: APIClient?
    private let configurationError: String?
    private let prefersSnapshot: Bool
    private(set) var dataCache: MyHouseCache?

    /// Incrementa em `reset()` e a cada `load()`: um carregamento que acorda depois de uma troca de usuário percebe e se descarta.
    private var generation = 0

    var house: House? { home?.house }
    var members: [User] { home?.members ?? [] }
    var rooms: [Room] { home?.rooms ?? [] }
    var inviteCode: String? { home?.house.accessCode }
    var currentUserId: UUID? { me?.id }

    init(api: APIClient?, configurationError: String? = nil, prefersSnapshot: Bool = false) {
        self.api = api
        self.configurationError = configurationError
        self.prefersSnapshot = prefersSnapshot
        self.dataCache = api.map { MyHouseCache(api: $0, prefersSnapshot: prefersSnapshot) }
    }

    // MARK: - Carregamento

    func load() async {
        guard !isLoading else { return }
        generation += 1
        let current = generation
        var cancelled = false
        isLoading = true
        errorMessage = nil
        loadError = nil
        defer {
            if current == generation { isLoading = false; hasLoaded = !cancelled }
        }
        guard let api else {
            loadError = .failed(configurationError ?? APIConfiguration.ConfigurationError.missing.localizedDescription)
            return
        }
        do {
            if prefersSnapshot, let snapshot = try await dataCache?.snapshot() {
                guard current == generation else { return }
                me = User(id: snapshot.userID, name: "", email: nil)
                apply(snapshot.home)
                return
            }
            let account = try await Self.fetchAccount(api)
            guard current == generation else { return }
            me = account
            guard account != nil else {
                home = nil
                return
            }
            let fetched = try await Self.fetchHome(api)
            guard current == generation else { return }
            apply(fetched)
        } catch let error as APIError where error.code == "no_house" || error.code == "account_not_registered" {
            guard current == generation else { return }
            home = nil
            me = nil
        } catch is CancellationError {
            cancelled = true
        } catch {
            guard current == generation else { return }
            loadError = Self.classify(error)
        }
    }

    func refresh() async {
        guard let api else { return }
        let current = generation
        let cache = dataCache
        do {
            await cache?.invalidate()
            let fetched: MyHouseDTO?
            if let cache { fetched = try await cache.myHouse() }
            else { fetched = try await Self.fetchHome(api) }
            guard current == generation else { return }
            apply(fetched)
        } catch is CancellationError {
        } catch let error as APIError where error.code == "no_house" {
            if current == generation { home = nil }
        } catch {
            if current == generation { errorMessage = Self.message(for: error) }
        }
    }

    // MARK: - Criar / entrar / sair

    func createHouse(name: String, myName: String) async {
        let houseName = name.trimmed
        let residentName = myName.trimmed
        guard !houseName.isEmpty, !residentName.isEmpty else { return }
        await perform { api in
            try await self.ensureAccount(api, name: residentName)
            let body = CreateHouseBody(name: houseName, timezone: TimeZone.current.identifier)
            self.apply(try await api.post(MyHouseDTO.self, "v1/houses", body: body))
        }
    }

    func joinHouse(code: String, myName: String) async {
        let normalized = code.trimmed.uppercased()
        let residentName = myName.trimmed
        guard !normalized.isEmpty, !residentName.isEmpty else { return }
        await perform { api in
            try await self.ensureAccount(api, name: residentName)
            self.apply(try await api.post(MyHouseDTO.self, "v1/houses/join", body: JoinHouseBody(code: normalized)))
        }
    }

    /// Sai da casa. Se algum cômodo seria excluído, `leaveNeedsConfirmation` fica verdadeiro e a tela repete com
    /// `confirmRoomDeletion`; se o morador é o último, `leaveNeedsHouseDeletionConfirmation` e a tela repete com
    /// `confirmHouseDeletion` (a casa inteira é excluída no servidor).
    func leaveHouse(confirmRoomDeletion: Bool = false, confirmHouseDeletion: Bool = false) async {
        var query: [String: String] = [:]
        if confirmRoomDeletion { query["confirmRoomDeletion"] = "true" }
        if confirmHouseDeletion { query["confirmHouseDeletion"] = "true" }
        await perform { api in
            do {
                try await api.send("DELETE", "v1/me/house", query: query)
            } catch let error as APIError where error.code == "room_deletion_confirmation_required" && !confirmRoomDeletion {
                self.leaveNeedsConfirmation = true
                return
            } catch let error as APIError where error.code == "house_deletion_confirmation_required" && !confirmHouseDeletion {
                self.leaveNeedsHouseDeletionConfirmation = true
                return
            }
            self.home = nil
        }
    }

    /// Muda o nome da casa (`PATCH /v1/houses/{id}`). Qualquer morador pode. `true` = salvou; senão `errorMessage` traz o motivo.
    func renameHouse(to name: String) async -> Bool {
        let newName = name.trimmed
        guard let house else { return false }
        guard !newName.isEmpty else {
            errorMessage = String(localized: "A casa precisa de um nome.")
            return false
        }
        guard newName != house.name else { return true }
        var saved = false
        await perform { api in
            self.apply(try await api.patch(MyHouseDTO.self, "v1/houses/\(house.id.apiString)", body: RenameBody(name: newName)))
            saved = true
        }
        return saved
    }

    /// Troca (`jpeg`) ou tira (`nil`) a foto do perfil. A foto vai direto ao S3 por URL pré-assinada e o servidor só
    /// confirma a chave. `true` = salvou; senão `errorMessage` traz o motivo.
    func updatePhoto(jpeg: Data?) async -> Bool {
        var saved = false
        await perform { api in
            guard let jpeg else {
                try await api.send("DELETE", "v1/me/photo")
                saved = true
                return
            }
            let target = try await api.post(PhotoUploadTargetDTO.self, "v1/me/photo")
            var request = URLRequest(url: target.uploadURL)
            request.httpMethod = "PUT"
            request.httpBody = jpeg
            request.timeoutInterval = 60
            for (name, value) in target.headers { request.setValue(value, forHTTPHeaderField: name) }
            let (_, response) = try await api.transport.data(for: request)
            guard (200..<300).contains(response.statusCode) else { throw APIError.http(status: response.statusCode, code: "photo_upload_failed") }
            try await api.send("PUT", "v1/me/photo", body: ConfirmPhotoBody(key: target.key))
            saved = true
        }
        if saved { await refresh() }
        return saved
    }

    /// Muda o nome do morador logado (`PATCH /v1/me`). `true` = salvou; senão `errorMessage` traz o motivo.
    func updateMyName(to name: String) async -> Bool {
        let newName = name.trimmed
        guard let me else { return false }
        guard !newName.isEmpty else {
            errorMessage = String(localized: "Informe um nome válido.")
            return false
        }
        guard newName != me.name else { return true }
        var saved = false
        await perform { api in
            _ = try await api.patch(RegisteredAccountDTO.self, "v1/me", body: RenameBody(name: newName))
            self.me = User(id: me.id, name: newName, email: me.email, photoURL: me.photoURL)
            if let home = self.home {
                let members = home.members.map {
                    $0.id == me.id ? User(id: $0.id, name: newName, email: $0.email, photoURL: $0.photoURL) : $0
                }
                self.home = Home(house: home.house, members: members, rooms: home.rooms)
            }
            saved = true
        }
        return saved
    }

    /// Cria os primeiros cômodos da casa e as tarefas sugeridas de cada um (passo do onboarding). Usa as mesmas rotas
    /// de Criar Cômodo e Criar Tarefa; se alguma falhar, para e devolve quantos cômodos já nasceram (o app segue para a
    /// casa, onde o "+" cria o resto). Tarefa sugerida entra como "Repetir com o cômodo".
    func createStarterRooms(_ starters: [StarterRoom]) async -> Int {
        guard let api, let house else { return 0 }
        var created = 0
        do {
            for starter in starters {
                let periodicity = WeeklyPeriodicity()
                let room = try await api.post(
                    RoomDTO.self, "v1/houses/\(house.id.apiString)/rooms",
                    body: CreateRoomBody(
                        name: starter.name, visibility: .common, category: starter.category,
                        periodicity: PeriodicityDTO(periodicity), responsibleCount: 1,
                        icon: starter.icon, color: starter.color, participantIDs: nil
                    )
                )
                created += 1
                for suggestion in starter.suggestedTasks() {
                    _ = try await api.post(
                        TaskDefinitionDTO.self, "v1/rooms/\(room.id.apiString)/tasks",
                        body: CreateTaskBody(
                            name: suggestion.name, details: suggestion.details, effort: suggestion.effort.points,
                            kind: .recurring, recurrence: RecurrenceDTO(.weekly(periodicity)),
                            assignmentPolicy: .balancedAutomatically, followsRoom: true
                        )
                    )
                }
            }
        } catch {
            errorMessage = Self.message(for: error)
        }
        await dataCache?.invalidate()
        await refresh()
        return created
    }

    /// Apaga a conta no servidor: sai da casa (o último morador leva a casa junto), desvincula o WhatsApp, remove o
    /// perfil e o usuário no Cognito. Repetir é seguro. `true` = a conta acabou; o app só encerra a sessão local.
    func deleteAccountOnServer() async -> Bool {
        var deleted = false
        await perform { api in
            try await api.send("DELETE", "v1/me")
            deleted = true
        }
        return deleted
    }

    /// Chamar no logout.
    func reset() {
        generation += 1
        isLoading = false
        home = nil
        me = nil
        errorMessage = nil
        loadError = nil
        leaveNeedsConfirmation = false
        leaveNeedsHouseDeletionConfirmation = false
        hasLoaded = false
        dataCache = api.map { MyHouseCache(api: $0, prefersSnapshot: prefersSnapshot) }
    }

    // MARK: - Privado

    private func apply(_ dto: MyHouseDTO) {
        home = Home(house: dto.house.domain, members: dto.members.map(\.domain), rooms: dto.rooms.map(\.domain))
        // `GET /v1/me` só devolve o id: o nome vem da lista de moradores.
        if let me, let mine = dto.members.first(where: { $0.id == me.id }) {
            self.me = User(id: me.id, name: mine.name, email: nil, photoURL: mine.photoURL)
        }
    }

    private func apply(_ fetched: MyHouseDTO?) {
        if let fetched { apply(fetched) } else { home = nil }
    }

    private func ensureAccount(_ api: APIClient, name: String) async throws {
        if me != nil { return }
        let registered = try await api.post(RegisteredAccountDTO.self, "v1/me", body: RegisterAccountBody(name: name))
        me = User(id: registered.id, name: name, email: nil)
    }

    private func perform(_ work: @MainActor (APIClient) async throws -> Void) async {
        guard let api else {
            errorMessage = configurationError ?? APIConfiguration.ConfigurationError.missing.localizedDescription
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            try await work(api)
            await dataCache?.invalidate()
        } catch {
            errorMessage = Self.message(for: error)
            if case .sessionExpired = Self.classify(error) { loadError = .sessionExpired }
        }
    }

    /// `nil` = conta ainda não registrada (403 `account_not_registered`).
    private static func fetchAccount(_ api: APIClient) async throws -> User? {
        do {
            let account = try await api.get(RegisteredAccountDTO.self, "v1/me")
            return User(id: account.id, name: "", email: nil)
        } catch let error as APIError where error.code == "account_not_registered" {
            return nil
        }
    }

    /// `nil` = sem casa (404 `no_house`).
    private static func fetchHome(_ api: APIClient) async throws -> MyHouseDTO? {
        do {
            return try await api.get(MyHouseDTO.self, "v1/me/house")
        } catch let error as APIError where error.code == "no_house" {
            return nil
        }
    }

    static func classify(_ error: Error) -> LoadError {
        if let error = error as? APIError, error == .unauthorized { return .sessionExpired }
        return .failed(message(for: error))
    }

    static func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
