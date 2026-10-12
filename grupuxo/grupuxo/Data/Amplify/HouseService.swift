import Foundation
import Combine
@preconcurrency import Amplify
import AWSPluginsCore

/// Estado da casa do usuário logado (backend: Amplify Data / AppSync).
/// Usa os models gerados pelo modelgen: HouseRecord, RoomRecord, MemberRecord, InviteCode.
///
/// Autorização: cada registro da casa guarda `members` (os `sub` dos moradores com conta) e só eles leem
/// e gravam. Por isso toda mudança na lista de moradores com conta reescreve `members` em todos os
/// registros da casa (`detach`), e entrar pelo código passa pela mutation `joinHouse` (função com IAM).
/// Camada transitória: a fonte da verdade da casa é o backend TypeScript (docs/BACKEND.md).
@MainActor
final class HouseService: ObservableObject {
    /// Todos os moradores têm o mesmo peso de decisão; o campo `role` do backend
    /// é mantido apenas por compatibilidade e sempre recebe este valor.
    enum Role {
        static let member = "MEMBER"
    }

    @Published private(set) var house: HouseRecord?
    @Published private(set) var rooms: [RoomRecord] = []
    @Published private(set) var members: [MemberRecord] = []
    @Published private(set) var invite: InviteCode?
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoaded = false
    @Published var errorMessage: String?
    /// Erro do carregamento inicial (rede/auth). Separado de errorMessage das ações.
    @Published private(set) var loadError: LoadError?

    enum LoadError: Equatable {
        /// A sessão acabou: não adianta tentar de novo, o app volta ao login.
        case sessionExpired
        case failed(String)

        var message: String {
            switch self {
            case .sessionExpired: "Sua sessão expirou. Entre novamente."
            case .failed(let message): message
            }
        }
    }

    private(set) var currentUserId: String?

    /// Incrementa em `reset()` e a cada `load()`; um `load()` que acorda depois de uma troca de
    /// usuário (ou de outro `load()`) percebe que não é mais o atual e descarta o resultado.
    private var generation = 0

    /// Código de convite da casa (o `id` do `InviteCode` é o próprio código).
    var inviteCode: String? { invite?.id }

    var myMember: MemberRecord? {
        guard let currentUserId else { return nil }
        return members.first { $0.userId == currentUserId }
    }


    // Scan com filtro: o limite precisa cobrir a tabela inteira (ok para MVP).
    private let listLimit = 1000

    // MARK: - Carregamento

    /// Descobre a casa do usuário logado (via MemberRecord.userId).
    func load() async {
        guard !isLoading else { return }
        generation += 1
        let current = generation
        isLoading = true
        errorMessage = nil
        loadError = nil
        defer {
            // Se o `reset()` ou outro `load()` passou na frente, o estado já não é deste carregamento.
            if current == generation { isLoading = false; hasLoaded = true }
        }

        do {
            let userId = try await Amplify.Auth.getCurrentUser().userId
            guard current == generation else { return }
            currentUserId = userId

            let memberships = try await list(MemberRecord.self, where: MemberRecord.keys.userId == userId)
            guard current == generation else { return }
            guard let membership = memberships.first,
                  let found = try await get(HouseRecord.self, id: membership.houseId) else {
                guard current == generation else { return }
                clearHouse()
                return
            }
            guard current == generation else { return }
            house = found
            try await fetchDetails(houseId: found.id, generation: current)
        } catch {
            guard current == generation else { return }
            loadError = Self.classify(error)
        }
    }

    func refresh() async {
        guard let house else { return await load() }
        do {
            try await fetchDetails(houseId: house.id)
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    // MARK: - Criar / entrar / sair

    func createHouse(name: String, myName: String) async {
        let houseName = name.trimmed
        let residentName = myName.trimmed
        guard !houseName.isEmpty, !residentName.isEmpty else { return }

        await perform {
            let userId = try await self.requireUserId()

            let newHouse = try await self.mutate(.create(
                HouseRecord(name: houseName, ownerId: userId, members: [userId])
            ))
            var createdInvite: InviteCode?
            do {
                createdInvite = try await self.createInvite(houseId: newHouse.id, members: [userId])
                _ = try await self.mutate(.create(
                    MemberRecord(houseId: newHouse.id, userId: userId, name: residentName,
                                 role: Role.member, members: [userId])
                ))
            } catch {
                // Desfaz o que já foi criado para não deixar uma casa sem código ou sem morador.
                if let createdInvite { _ = try? await self.mutate(.delete(createdInvite)) }
                _ = try? await self.mutate(.delete(newHouse))
                throw error
            }

            self.house = newHouse
            try await self.fetchDetails(houseId: newHouse.id)
        }
    }

    func joinHouse(code: String, myName: String) async {
        let normalized = code.trimmed.uppercased()
        let residentName = myName.trimmed
        guard !normalized.isEmpty, !residentName.isEmpty else { return }

        await perform {
            _ = try await self.requireUserId()

            let found: HouseRecord
            do {
                found = try await self.mutate(GraphQLRequest<HouseRecord>(
                    document: Self.joinHouseDocument,
                    variables: ["code": normalized, "memberName": residentName],
                    responseType: HouseRecord.self,
                    decodePath: "joinHouse"
                ))
            } catch {
                if "\(error)".contains(Self.invalidCodeMarker) { throw HouseServiceError.invalidCode }
                throw error
            }

            self.house = found
            try await self.fetchDetails(houseId: found.id)
        }
    }

    /// Sai da casa. Se for o último morador com conta, apaga a casa inteira.
    func leaveHouse() async {
        guard let house, let me = myMember else { return }

        await perform {
            let othersWithAccount = self.members.filter { $0.userId != nil && $0.id != me.id }

            if othersWithAccount.isEmpty {
                for room in self.rooms { _ = try await self.mutate(.delete(room)) }
                for member in self.members { _ = try await self.mutate(.delete(member)) }
                if let invite = self.invite { _ = try await self.mutate(.delete(invite)) }
                _ = try await self.mutate(.delete(house))
            } else {
                try await self.detach(me, from: house)
            }
            self.clearHouse()
        }
    }

    // MARK: - Cômodos

    func addRoom(name: String, id: String = UUID().uuidString) async {
        guard house != nil, !name.trimmed.isEmpty else { return }
        await perform { try await self.createRoomRecord(name: name, id: id) }
    }

    /// Variante para quem mostra o erro por conta própria (o editor de cômodo): lança em vez de
    /// preencher `errorMessage`.
    func addRoomOrThrow(name: String, id: String) async throws {
        guard !name.trimmed.isEmpty else { throw HouseServiceError.invalidRoomName }
        try await createRoomRecord(name: name, id: id)
    }

    private func createRoomRecord(name: String, id: String) async throws {
        guard let house else { throw HouseServiceError.houseUnavailable }
        let room = try await mutate(.create(
            RoomRecord(id: id, houseId: house.id, name: name.trimmed, members: house.members)
        ))
        rooms.append(room)
        rooms.sort { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    func renameRoom(_ room: RoomRecord, to name: String) async {
        guard !name.trimmed.isEmpty else { return }
        await perform {
            var updated = room
            updated.name = name.trimmed
            let saved = try await self.mutate(.update(updated))
            if let index = self.rooms.firstIndex(where: { $0.id == saved.id }) {
                self.rooms[index] = saved
            }
        }
    }

    func deleteRoom(_ room: RoomRecord) async {
        await perform {
            _ = try await self.mutate(.delete(room))
            self.rooms.removeAll { $0.id == room.id }
        }
    }

    // MARK: - Moradores

    /// Adiciona morador sem conta (userId vazio).
    func addResident(name: String) async {
        guard let house, !name.trimmed.isEmpty else { return }
        await perform {
            let member = try await self.mutate(.create(
                MemberRecord(houseId: house.id, userId: nil, name: name.trimmed,
                             role: Role.member, members: house.members)
            ))
            self.members.append(member)
        }
    }

    func removeMember(_ member: MemberRecord) async {
        guard let house, member.id != myMember?.id else { return }
        await perform {
            if member.userId != nil {
                try await self.detach(member, from: house)
                if let updated = try await self.get(HouseRecord.self, id: house.id) { self.house = updated }
                try await self.fetchDetails(houseId: house.id)
            } else {
                _ = try await self.mutate(.delete(member))
                self.members.removeAll { $0.id == member.id }
            }
        }
    }

    /// Chamar no logout.
    func reset() {
        generation += 1
        isLoading = false
        clearHouse()
        currentUserId = nil
        errorMessage = nil
        loadError = nil
        hasLoaded = false
    }

    // MARK: - Privado

    private func clearHouse() {
        house = nil
        rooms = []
        members = []
        invite = nil
    }

    /// `generation`: só o `load()` passa; descarta o resultado se o usuário mudou durante a busca.
    private func fetchDetails(houseId: String, generation expected: Int? = nil) async throws {
        async let roomList = list(RoomRecord.self, where: RoomRecord.keys.houseId == houseId)
        async let memberList = list(MemberRecord.self, where: MemberRecord.keys.houseId == houseId)
        async let inviteList = list(InviteCode.self, where: InviteCode.keys.houseId == houseId)
        let fetchedRooms = try await roomList.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        let fetchedMembers = try await memberList.sorted {
            $0.name.localizedCompare($1.name) == .orderedAscending
        }
        let fetchedInvite = try await inviteList.first
        if let expected, expected != generation { return }
        rooms = fetchedRooms
        members = fetchedMembers
        invite = fetchedInvite
    }

    private func perform(_ work: @MainActor () async throws -> Void) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            try await work()
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    private func requireUserId() async throws -> String {
        if let currentUserId { return currentUserId }
        let id = try await Amplify.Auth.getCurrentUser().userId
        currentUserId = id
        return id
    }

    /// Cria o código de convite. O `id` é o código, então o AppSync recusa um código que já existe
    /// (condição de escrita) e tentamos outro.
    private func createInvite(houseId: String, members: [String]) async throws -> InviteCode {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") // sem 0/O/1/I
        for _ in 0..<5 {
            let code = String((0..<6).map { _ in alphabet.randomElement()! })
            do {
                return try await mutate(.create(InviteCode(id: code, houseId: houseId, members: members)))
            } catch {
                guard "\(error)".contains("Conditional") else { throw error }
            }
        }
        throw HouseServiceError.codeGenerationFailed
    }

    /// Tira um morador com conta da casa: reescreve `members` nos outros registros, apaga o registro dele e,
    /// por último, atualiza a casa (depois disso quem saiu perde o acesso, então não pode ser antes).
    private func detach(_ member: MemberRecord, from house: HouseRecord) async throws {
        guard let userId = member.userId else { return }
        let remaining = house.members.filter { $0 != userId }

        for var room in rooms {
            room.members = remaining
            _ = try await mutate(.update(room))
        }
        for var other in members where other.id != member.id {
            other.members = remaining
            _ = try await mutate(.update(other))
        }
        if var invite {
            invite.members = remaining
            _ = try await mutate(.update(invite))
        }
        _ = try await mutate(.delete(member))
        var updated = house
        updated.members = remaining
        _ = try await mutate(.update(updated))
    }

    private static let invalidCodeMarker = "INVALID_INVITE_CODE"

    private static let joinHouseDocument = """
    mutation JoinHouse($code: String!, $memberName: String!) {
      joinHouse(code: $code, memberName: $memberName) {
        id
        name
        ownerId
        members
        createdAt
        updatedAt
        __typename
      }
    }
    """

    // MARK: Helpers Amplify

    private func list<M: Model>(_ type: M.Type, where predicate: QueryPredicate) async throws -> [M] {
        let result = try await Amplify.API.query(request: .list(type, where: predicate, limit: listLimit))
        switch result {
        case .success(let list): return Array(list)
        case .failure(let error): throw error
        }
    }

    private func get<M: Model>(_ type: M.Type, id: String) async throws -> M? {
        let result = try await Amplify.API.query(request: .get(type, byId: id))
        switch result {
        case .success(let model): return model
        case .failure(let error): throw error
        }
    }

    private func mutate<M: Model>(_ request: GraphQLRequest<M>) async throws -> M {
        let result = try await Amplify.API.mutate(request: request)
        switch result {
        case .success(let model): return model
        case .failure(let error): throw error
        }
    }

    /// Separa "a sessão acabou" de "falhou" (rede etc.). O AppSync embrulha o `AuthError` como erro
    /// subjacente do `APIError`, então desenrola a cadeia (hipótese: só um teste real confirma o formato).
    static func classify(_ error: Error) -> LoadError {
        var current: Error? = error
        var depth = 0
        while let candidate = current, depth < 10 {
            if let auth = candidate as? AuthError {
                switch auth {
                case .sessionExpired, .signedOut: return .sessionExpired
                default: break
                }
            }
            current = (candidate as? AmplifyError)?.underlyingError
            depth += 1
        }
        return .failed(message(for: error))
    }

    private static func message(for error: Error) -> String {
        if let error = error as? HouseServiceError { return error.localizedDescription }
        if let error = error as? AmplifyError { return error.errorDescription }
        return error.localizedDescription
    }
}

enum HouseServiceError: LocalizedError {
    case invalidCode
    case codeGenerationFailed
    case houseUnavailable
    case invalidRoomName

    var errorDescription: String? {
        switch self {
        case .houseUnavailable: "Sua casa não está carregada. Tente novamente."
        case .invalidRoomName: "Dê um nome ao cômodo."
        case .invalidCode: "Código de convite inválido."
        case .codeGenerationFailed: "Não foi possível gerar um código de convite. Tente novamente."
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
