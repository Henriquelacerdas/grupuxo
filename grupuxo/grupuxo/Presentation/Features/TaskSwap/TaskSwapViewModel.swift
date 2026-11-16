//
//  TaskSwapViewModel.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//
import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class TaskSwapViewModel: ObservableObject {

    /// Tarefas que podem ser pedidas em troca, de um mesmo esforço. O grupo do esforço da sua tarefa vem primeiro.
    struct CandidateGroup: Identifiable, Equatable {
        let effort: TaskEffortLevel
        let isSameEffort: Bool
        let items: [TaskItem]

        var id: Int { effort.rawValue }
    }

    @Published private(set) var state: TaskSwapState = .idle
    @Published private(set) var isSending = false
    @Published private(set) var selectedID: TaskOccurrence.ID?
    @Published private(set) var roomNames: [Room.ID: String] = [:]

    private let getMyTasks: GetMyTasksUseCase
    private let getCandidates: GetTaskSwapCandidatesUseCase
    private let createRequest: CreateTaskSwapRequestUseCase
    /// Só para mostrar o cômodo de cada tarefa; sem ele, as linhas ficam sem o nome do cômodo.
    private let getRooms: GetHouseRoomsUseCase?

    private let userID: User.ID
    private let houseID: House.ID
    private let offeredOccurrenceID: TaskOccurrence.ID
    private let text: MyTasksText

    init(
        getMyTasks: GetMyTasksUseCase,
        getCandidates: GetTaskSwapCandidatesUseCase,
        createRequest: CreateTaskSwapRequestUseCase,
        getRooms: GetHouseRoomsUseCase? = nil,
        userID: User.ID,
        houseID: House.ID,
        offeredOccurrenceID: TaskOccurrence.ID,
        calendar: Calendar = .current
    ) {
        self.getMyTasks = getMyTasks
        self.getCandidates = getCandidates
        self.createRequest = createRequest
        self.getRooms = getRooms
        self.userID = userID
        self.houseID = houseID
        self.offeredOccurrenceID = offeredOccurrenceID
        self.text = MyTasksText(calendar: calendar, locale: HouseOverviewText.appLocale)
    }

    func load() async {
        state = .loading

        do {
            async let rooms = loadRoomNames()

            let myTasks = try await getMyTasks(
                userID: userID,
                houseID: houseID
            )

            guard let offeredTask = myTasks.first(
                where: {
                    $0.id == offeredOccurrenceID
                }
            ) else {
                state = .failure(
                    String(localized: "A tarefa oferecida não está mais disponível.")
                )
                return
            }

            let candidates = try await getCandidates(
                requesterID: userID,
                offeredOccurrenceID: offeredOccurrenceID,
                houseID: houseID
            )

            roomNames = await rooms
            state = .content(
                offeredTask: offeredTask,
                candidates: candidates
            )

        } catch is CancellationError {
            // A tela saiu antes da resposta.
        } catch {
            state = .failure(
                error.localizedDescription
            )
        }
    }

    func select(_ occurrenceID: TaskOccurrence.ID) {
        guard !isSending else { return }
        selectedID = occurrenceID
    }

    /// Envia o pedido para a tarefa escolhida.
    func sendSelected() async {
        guard let selectedID else { return }
        await requestSwap(requestedOccurrenceID: selectedID)
    }

    func requestSwap(
        requestedOccurrenceID: TaskOccurrence.ID
    ) async {

        guard !isSending else {
            return
        }

        isSending = true
        defer {
            isSending = false
        }

        do {
            _ = try await createRequest(
                requesterID: userID,
                offeredOccurrenceID: offeredOccurrenceID,
                requestedOccurrenceID: requestedOccurrenceID
            )

            state = .sent

        } catch {
            state = .failure(
                error.localizedDescription
            )
        }
    }

    // MARK: - Apresentação

    /// Agrupa por esforço: primeiro o mesmo esforço da sua tarefa, depois os outros, do mais leve ao mais intenso.
    func groups(offered: TaskItem, candidates: [TaskItem]) -> [CandidateGroup] {

        let offeredLevel = Self.level(of: offered)

        let ordered = [offeredLevel] + TaskEffortLevel.allCases.filter { $0 != offeredLevel }

        return ordered.compactMap { level in
            let items = candidates
                .filter { Self.level(of: $0) == level }
                .sorted {
                    ($0.definition.name, $0.id.uuidString.lowercased())
                        < ($1.definition.name, $1.id.uuidString.lowercased())
                }
            guard !items.isEmpty else { return nil }
            return CandidateGroup(effort: level, isSameEffort: level == offeredLevel, items: items)
        }
    }

    /// "Cozinha · Médio · Termina domingo".
    func offeredSummary(_ item: TaskItem) -> String {
        [
            roomNames[item.definition.roomID],
            RoomDetailText.effort(item.occurrence.effortSnapshot),
            text.timing(availableAt: item.occurrence.availableAt, dueAt: item.occurrence.dueAt, now: .now)?.text,
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }

    /// "Henrique L. · Banheiro".
    func candidateSummary(_ item: TaskItem) -> String {
        [
            item.assignee.map { ResidentNameFormatting.shortName($0.name) },
            roomNames[item.definition.roomID],
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }

    private static func level(of item: TaskItem) -> TaskEffortLevel {
        TaskEffortLevel(rawValue: item.occurrence.effortSnapshot.points) ?? .intense
    }

    private func loadRoomNames() async -> [Room.ID: String] {
        guard let getRooms else { return [:] }
        let rooms = (try? await getRooms(houseID: houseID, userID: userID, participatingOnly: false)) ?? []
        return Dictionary(rooms.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }
}
