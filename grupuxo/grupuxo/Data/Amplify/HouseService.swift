import Foundation
import Combine
@preconcurrency import Amplify
import AWSPluginsCore

/// Estado da casa do usuário logado (backend: Amplify Data / AppSync).
/// Usa os models gerados pelo modelgen: HouseRecord, RoomRecord, MemberRecord.
@MainActor
final class HouseService: ObservableObject {
    enum Role {
        static let admin = "ADMIN"
        static let member = "MEMBER"
    }

    @Published private(set) var house: HouseRecord?
    @Published private(set) var rooms: [RoomRecord] = []
    @Published private(set) var members: [MemberRecord] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoaded = false
    @Published var errorMessage: String?
    /// Erro do carregamento inicial (rede/auth). Separado de errorMessage das ações.
    @Published private(set) var loadError: String?

    private(set) var currentUserId: String?

    var myMember: MemberRecord? {
        guard let currentUserId else { return nil }
        return members.first { $0.userId == currentUserId }
    }

    var isAdmin: Bool { myMember?.role == Role.admin }

    // Scan com filtro: o limite precisa cobrir a tabela inteira (ok para MVP).
    private let listLimit = 1000

    // MARK: - Carregamento

    /// Descobre a casa do usuário logado (via MemberRecord.userId).
    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        loadError = nil
        defer { isLoading = false; hasLoaded = true }

        do {
            let userId = try await Amplify.Auth.getCurrentUser().userId
            currentUserId = userId

            let memberships = try await list(MemberRecord.self, where: MemberRecord.keys.userId == userId)
            guard let membership = memberships.first,
                  let found = try await get(HouseRecord.self, id: membership.houseId) else {
                clearHouse()
                return
            }
            house = found
            try await fetchDetails(houseId: found.id)
        } catch {
            loadError = Self.message(for: error)
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
            let code = try await self.generateUniqueInviteCode()

            let newHouse = try await self.mutate(.create(
                HouseRecord(name: houseName, inviteCode: code, ownerId: userId)
            ))
            _ = try await self.mutate(.create(
                MemberRecord(houseId: newHouse.id, userId: userId, name: residentName, role: Role.admin)
            ))

            self.house = newHouse
            try await self.fetchDetails(houseId: newHouse.id)
        }
    }

    func joinHouse(code: String, myName: String) async {
        let normalized = code.trimmed.uppercased()
        let residentName = myName.trimmed
        guard !normalized.isEmpty, !residentName.isEmpty else { return }

        await perform {
            let userId = try await self.requireUserId()
            let matches = try await self.list(HouseRecord.self, where: HouseRecord.keys.inviteCode == normalized)
            guard let found = matches.first else { throw HouseServiceError.invalidCode }

            let existing = try await self.list(MemberRecord.self, where: MemberRecord.keys.houseId == found.id)
            if !existing.contains(where: { $0.userId == userId }) {
                _ = try await self.mutate(.create(
                    MemberRecord(houseId: found.id, userId: userId, name: residentName, role: Role.member)
                ))
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
                _ = try await self.mutate(.delete(house))
            } else {
                // Garante que a casa continue com um admin.
                if me.role == Role.admin,
                   !othersWithAccount.contains(where: { $0.role == Role.admin }),
                   var heir = othersWithAccount.first {
                    heir.role = Role.admin
                    _ = try await self.mutate(.update(heir))
                }
                _ = try await self.mutate(.delete(me))
            }
            self.clearHouse()
        }
    }

    // MARK: - Cômodos

    func addRoom(name: String) async {
        guard let house, !name.trimmed.isEmpty else { return }
        await perform {
            let room = try await self.mutate(.create(RoomRecord(houseId: house.id, name: name.trimmed)))
            self.rooms.append(room)
            self.rooms.sort { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
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
        guard let house, isAdmin, !name.trimmed.isEmpty else { return }
        await perform {
            let member = try await self.mutate(.create(
                MemberRecord(houseId: house.id, userId: nil, name: name.trimmed, role: Role.member)
            ))
            self.members.append(member)
        }
    }

    func removeMember(_ member: MemberRecord) async {
        guard isAdmin, member.id != myMember?.id else { return }
        await perform {
            _ = try await self.mutate(.delete(member))
            self.members.removeAll { $0.id == member.id }
        }
    }

    func setRole(_ member: MemberRecord, admin: Bool) async {
        guard isAdmin, member.userId != nil, member.id != myMember?.id else { return }
        await perform {
            var updated = member
            updated.role = admin ? Role.admin : Role.member
            let saved = try await self.mutate(.update(updated))
            if let index = self.members.firstIndex(where: { $0.id == saved.id }) {
                self.members[index] = saved
            }
        }
    }

    /// Chamar no logout.
    func reset() {
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
    }

    private func fetchDetails(houseId: String) async throws {
        async let roomList = list(RoomRecord.self, where: RoomRecord.keys.houseId == houseId)
        async let memberList = list(MemberRecord.self, where: MemberRecord.keys.houseId == houseId)
        rooms = try await roomList.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        members = try await memberList.sorted { lhs, rhs in
            if lhs.role != rhs.role { return lhs.role == Role.admin }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
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

    private func generateUniqueInviteCode() async throws -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") // sem 0/O/1/I
        for _ in 0..<5 {
            let code = String((0..<6).map { _ in alphabet.randomElement()! })
            let clash = try await list(HouseRecord.self, where: HouseRecord.keys.inviteCode == code)
            if clash.isEmpty { return code }
        }
        throw HouseServiceError.codeGenerationFailed
    }

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

    private static func message(for error: Error) -> String {
        if let error = error as? HouseServiceError { return error.localizedDescription }
        if let error = error as? AmplifyError { return error.errorDescription }
        return error.localizedDescription
    }
}

enum HouseServiceError: LocalizedError {
    case invalidCode
    case codeGenerationFailed

    var errorDescription: String? {
        switch self {
        case .invalidCode: "Código de convite inválido."
        case .codeGenerationFailed: "Não foi possível gerar um código de convite. Tente novamente."
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
