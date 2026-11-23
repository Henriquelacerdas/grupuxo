import Combine
import Foundation
import GrupuxoDomain

/// Avaliar a semana e Resumo da semana (docs/DESIGN.md): cada morador avalia os cômodos cujo ciclo acabou (menos os
/// que cuidou), com um de três níveis e tags opcionais; quem cuidou vê só o resultado agregado.
@MainActor
final class WeekRatingViewModel: ObservableObject {

    struct Draft: Equatable {
        var level: RatingLevel?
        var tags: Set<RatingTag> = []
    }

    @Published private(set) var pending: [PendingRating] = []
    @Published private(set) var summary: WeekSummary = .empty
    @Published private(set) var drafts: [Room.ID: Draft] = [:]
    @Published private(set) var isSaving = false
    /// Quando a janela da avaliação que o morador já enviou fecha (e o resumo sai); `nil` se não enviou ou já passou.
    @Published private(set) var submittedUntil: Date?
    @Published private(set) var roomLooks: [Room.ID: RoomLook] = [:]
    @Published var errorMessage: String?
    /// As folhas ficam fora da linha da lista (ver `WeekRatingSheetHost`): a linha é reciclada e perderia o estado.
    @Published var isRatingPresented = false
    @Published var isSummaryPresented = false

    /// Ícone e cor do cômodo, como no resto do app.
    struct RoomLook: Equatable {
        let icon: String
        let color: RoomColor
    }

    private let getPending: GetPendingRatingsUseCase
    private let rate: RateRoomsUseCase
    private let getSummary: GetRatingSummaryUseCase
    private let getRooms: GetHouseRoomsUseCase
    private let defaults: UserDefaults
    private let now: () -> Date
    let userID: User.ID
    private let houseID: House.ID

    init(
        getPending: GetPendingRatingsUseCase, rate: RateRoomsUseCase, getSummary: GetRatingSummaryUseCase,
        getRooms: GetHouseRoomsUseCase, userID: User.ID, houseID: House.ID,
        defaults: UserDefaults = .standard, now: @escaping () -> Date = { .now }
    ) {
        self.getPending = getPending
        self.rate = rate
        self.getSummary = getSummary
        self.getRooms = getRooms
        self.userID = userID
        self.houseID = houseID
        self.defaults = defaults
        self.now = now
    }

    /// A avaliação enviada não tem rota no servidor ("já avaliei"): o app lembra até a janela fechar, só neste aparelho.
    private var submittedKey: String { "weekRating.submittedUntil.\(houseID.uuidString).\(userID.uuidString)" }

    /// Falha aqui não atrapalha Minhas tarefas: a linha só não aparece.
    func load() async {
        pending = (try? await getPending(houseID: houseID, userID: userID)) ?? []
        summary = (try? await getSummary(houseID: houseID, userID: userID)) ?? .empty
        drafts = drafts.filter { entry in pending.contains { $0.roomID == entry.key } }
        if let rooms = try? await getRooms(houseID: houseID, userID: userID) {
            roomLooks = Dictionary(uniqueKeysWithValues: rooms.map { ($0.id, RoomLook(icon: $0.icon, color: $0.color)) })
        }
        refreshSubmitted()
    }

    private func refreshSubmitted() {
        let stored = defaults.object(forKey: submittedKey) as? Date
        submittedUntil = stored.flatMap { $0 > now() ? $0 : nil }
    }

    var hasPending: Bool { !pending.isEmpty }
    var hasSummary: Bool { summary.hasResultForMyRooms }
    /// "Avaliação enviada · O resumo sai terça": depois de enviar e até o resumo sair (Figma).
    var hasSubmitted: Bool { !hasPending && !hasSummary && submittedUntil != nil }

    /// "Termina terça": o fim da janela de avaliação mais próxima.
    var closesAt: Date? { pending.map(\.windowEnd).min() }

    func draft(for roomID: Room.ID) -> Draft { drafts[roomID] ?? Draft() }

    func select(_ level: RatingLevel, for roomID: Room.ID) {
        var draft = draft(for: roomID)
        draft.level = level
        // Cada nível tem as suas tags: ao trocar de lado, as marcadas antes saem.
        draft.tags = draft.tags.filter { RatingTag.options(for: level).contains($0) }
        drafts[roomID] = draft
    }

    func toggle(_ tag: RatingTag, for roomID: Room.ID) {
        var draft = draft(for: roomID)
        guard let level = draft.level, RatingTag.options(for: level).contains(tag) else { return }
        if draft.tags.contains(tag) { draft.tags.remove(tag) } else { draft.tags.insert(tag) }
        drafts[roomID] = draft
    }

    /// Só os cômodos com um nível escolhido vão ao servidor; fechar a folha sem enviar não grava nada.
    var canSubmit: Bool { !isSaving && pending.contains { draft(for: $0.roomID).level != nil } }

    /// `true` = enviou; as avaliações enviadas somem de "pendentes".
    func submit() async -> Bool {
        let choices = pending.compactMap { item -> RoomRatingChoice? in
            guard let level = draft(for: item.roomID).level else { return nil }
            let tags = RatingTag.allCases.filter { draft(for: item.roomID).tags.contains($0) }
            return RoomRatingChoice(roomID: item.roomID, periodStart: item.periodStart, level: level, tags: tags)
        }
        guard !choices.isEmpty, !isSaving else { return false }
        isSaving = true
        defer { isSaving = false }
        let windowEnd = pending.map(\.windowEnd).max()
        do {
            try await rate(choices, userID: userID)
            drafts = [:]
            if let windowEnd { defaults.set(windowEnd, forKey: submittedKey) }
            await load()
            return true
        } catch {
            errorMessage = error.localizedDescription
            await load()
            return false
        }
    }
}
