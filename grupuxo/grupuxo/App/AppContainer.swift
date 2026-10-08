import Foundation

/// Retrato da casa real (Amplify) usado para alimentar o store em memória.
struct HouseSnapshot: Sendable {
    struct Resident: Sendable { let id: UUID; let name: String }
    struct RoomInfo: Sendable { let id: UUID; let name: String }

    let houseID: UUID
    let houseName: String
    let inviteCode: String
    let residents: [Resident]
    let rooms: [RoomInfo]
}

@MainActor
final class AppContainer {

    let store: MockStore
    private let calendar: Calendar
    private let scheduling: TaskSchedulingService

    let houseRepository: any HouseRepository
    let roomRepository: any RoomRepository
    let taskRepository: any TaskRepository

    let taskSwapRepository: any TaskSwapRepository
    let notificationRepository: any NotificationRepository

    init(
        store: MockStore = MockStore(),
        calendar: Calendar = Calendar(identifier: .gregorian)
    ) {
        self.store = store
        self.calendar = calendar

        let scheduling = TaskSchedulingService(
            distribution: TaskDistributionEngine(
                optimizer: HungarianAlgorithm()
            ),
            fairness: FairnessCalculator(),
            rotation: RotationCalculator(),
            calendar: calendar
        )
        self.scheduling = scheduling

        roomRepository = MockRoomRepository(
            store: store,
            scheduling: scheduling
        )

        houseRepository = MockHouseRepository(
            store: store,
            scheduling: scheduling
        )

        taskRepository = MockTaskRepository(
            store: store,
            scheduling: scheduling
        )

        taskSwapRepository = MockTaskSwapRepository(
            store: store
        )

        notificationRepository = MockNotificationRepository(
            store: store
        )
    }

    // MARK: - Sincronização com a casa real

    /// Reflete moradores e cômodos reais no store. Cômodos já conhecidos mantêm
    /// seus dados (ícone, cor, participantes); os que sumiram são removidos.
    func sync(_ snapshot: HouseSnapshot, at date: Date = .now) async throws {
        let scheduling = self.scheduling

        try await store.update { state in
            let houseID = snapshot.houseID

            if let index = state.houses.firstIndex(where: { $0.id == houseID }) {
                state.houses[index].name = snapshot.houseName
                state.houses[index].accessCode = snapshot.inviteCode
            } else {
                state.houses.append(House(
                    id: houseID, name: snapshot.houseName,
                    accessCode: snapshot.inviteCode, createdAt: date
                ))
            }

            let wantedUsers = Set(snapshot.residents.map(\.id))
            var changed = false

            for resident in snapshot.residents {
                if let index = state.users.firstIndex(where: { $0.id == resident.id }) {
                    state.users[index].name = resident.name
                } else {
                    state.users.append(User(id: resident.id, name: resident.name, email: nil))
                }
            }

            var schedule = state.schedule

            // Moradores removidos.
            let removed = schedule.houseMemberships.filter {
                $0.houseID == houseID && !wantedUsers.contains($0.userID)
            }
            for membership in removed {
                let roomIDs = schedule.rooms.filter { $0.houseID == houseID }.map(\.id)
                for roomID in roomIDs {
                    try scheduling.removeMember(
                        userID: membership.userID, roomID: roomID, at: date,
                        confirmDeletion: true, houseChange: true, replan: false, state: &schedule
                    )
                }
                schedule.houseMemberships.removeAll { $0.id == membership.id }
                schedule.absences.removeAll { $0.membershipID == membership.id }
                changed = true
            }
            let removedUsers = Set(removed.map(\.userID))
            state.users.removeAll { removedUsers.contains($0.id) }

            // Moradores novos.
            let known = Set(schedule.houseMemberships.filter { $0.houseID == houseID }.map(\.userID))
            let addedUsers = snapshot.residents.map(\.id).filter { !known.contains($0) }
            for userID in addedUsers {
                schedule.houseMemberships.append(
                    HouseMembership(id: UUID(), houseID: houseID, userID: userID)
                )
                changed = true
            }

            // Cômodos removidos.
            let wantedRooms = Set(snapshot.rooms.map(\.id))
            let staleRooms = schedule.rooms.filter { $0.houseID == houseID && !wantedRooms.contains($0.id) }
            for room in staleRooms {
                scheduling.deleteRoom(room.id, state: &schedule)
                changed = true
            }

            // Cômodos novos / renomeados.
            let allUsers = snapshot.residents.map(\.id)
            var newRoomIDs = Set<UUID>()
            for info in snapshot.rooms {
                if let index = schedule.rooms.firstIndex(where: { $0.id == info.id }) {
                    schedule.rooms[index].name = info.name
                } else {
                    schedule.rooms.append(Room(
                        id: info.id, houseID: houseID, name: info.name,
                        kind: .standard, category: .other, visibility: .common,
                        calendarAnchor: try scheduling.weekStart(date),
                        icon: "square.split.bottomrightquarter", color: .blue
                    ))
                    schedule.roomMemberships.append(contentsOf: allUsers.map {
                        RoomMembership(id: UUID(), roomID: info.id, userID: $0)
                    })
                    newRoomIDs.insert(info.id)
                    changed = true
                }
            }

            // Moradores novos entram nos cômodos comuns que já existiam.
            for room in schedule.rooms where room.houseID == houseID
                && room.visibility == .common && !newRoomIDs.contains(room.id) {
                for userID in addedUsers {
                    try scheduling.addMember(
                        userID: userID, roomID: room.id, at: date, replan: false, state: &schedule
                    )
                }
            }

            try scheduling.initializeRooms(houseID: houseID, at: date, state: &schedule)
            if changed {
                try scheduling.rebalance(
                    houseID: houseID,
                    boundary: scheduling.addingWeeks(1, to: scheduling.weekStart(date)),
                    at: date, state: &schedule
                )
            }
            state.schedule = schedule
        }
    }

    func makeProfileViewModel(
        session: AppSession
    ) -> ProfileViewModel {
        ProfileViewModel(
            getMembers: GetHouseMembersUseCase(
                repository: houseRepository
            ),
            addMember: AddHouseMemberUseCase(
                repository: houseRepository
            ),
            removeMember: RemoveHouseMemberUseCase(
                repository: houseRepository
            ),
            houseID: session.currentHouse.id,
            currentUserID: session.currentUser.id
        )
    }

    func makeAddRoomMemberUseCase() -> AddRoomMemberUseCase {
        AddRoomMemberUseCase(
            repository: taskRepository
        )
    }

    func makeRemoveRoomMemberUseCase() -> RemoveRoomMemberUseCase {
        RemoveRoomMemberUseCase(
            repository: taskRepository
        )
    }

    func makeRefreshTaskScheduleUseCase() -> RefreshTaskScheduleUseCase {
        RefreshTaskScheduleUseCase(
            repository: taskRepository
        )
    }

    func makeMyTasksViewModel(
        session: AppSession
    ) -> MyTasksViewModel {
        MyTasksViewModel(
            getMyTasks: GetMyTasksUseCase(
                repository: taskRepository
            ),
            completeTask: CompleteTaskUseCase(
                repository: taskRepository
            ),
            userID: session.currentUser.id,
            houseID: session.currentHouse.id
        )
    }

    func makeHouseManagementViewModel(
        session: AppSession
    ) -> HouseManagementViewModel {
        HouseManagementViewModel(
            getHouseRooms: GetHouseRoomsUseCase(
                repository: roomRepository
            ),
            houseID: session.currentHouse.id,
            userID: session.currentUser.id
        )
    }

    func makeRoomDetailViewModel(
        roomID: Room.ID,
        session: AppSession
    ) -> RoomDetailViewModel {
        RoomDetailViewModel(
            getParticipation: GetRoomParticipationUseCase(
                repository: roomRepository
            ),
            addMember: makeAddRoomMemberUseCase(),
            removeMember: makeRemoveRoomMemberUseCase(),
            getRoomTasks: GetRoomTasksUseCase(
                repository: taskRepository
            ),
            getTaskSuggestions: GetTaskSuggestionsUseCase(
                catalog: TaskSuggestionCatalog()
            ),
            completeTask: CompleteTaskUseCase(
                repository: taskRepository
            ),
            deleteTask: DeleteTaskUseCase(
                repository: taskRepository
            ),
            roomID: roomID,
            userID: session.currentUser.id
        )
    }

    func makeSporadicTasksViewModel(
        session: AppSession
    ) -> SporadicTasksViewModel {
        SporadicTasksViewModel(
            getTasks: GetSporadicTasksUseCase(
                repository: taskRepository
            ),
            claimTask: ClaimSporadicTaskUseCase(
                repository: taskRepository
            ),
            releaseTask: ReleaseSporadicTaskUseCase(
                repository: taskRepository
            ),
            completeTask: CompleteTaskUseCase(
                repository: taskRepository
            ),
            userID: session.currentUser.id,
            houseID: session.currentHouse.id
        )
    }

    func makeTaskEditorViewModel(
        roomID: Room.ID?,
        session: AppSession
    ) -> TaskEditorViewModel {
        var draft = TaskDraft()
        draft.roomID = roomID

        return makeTaskEditorViewModel(
            draft: draft,
            session: session
        )
    }

    func makeTaskEditorViewModel(
        roomID: Room.ID,
        suggestion: TaskSuggestion,
        session: AppSession
    ) -> TaskEditorViewModel {
        var draft = TaskDraft()

        draft.roomID = roomID
        draft.name = suggestion.name
        draft.details = suggestion.details
        draft.effortPoints = suggestion.effort.points
        draft.sourceSuggestionID = suggestion.id

        return makeTaskEditorViewModel(
            draft: draft,
            session: session
        )
    }

    private func makeTaskEditorViewModel(
        draft: TaskDraft,
        session: AppSession
    ) -> TaskEditorViewModel {
        TaskEditorViewModel(
            createTask: CreateTaskUseCase(
                repository: taskRepository,
                roomRepository: roomRepository
            ),
            getHouseRooms: GetHouseRoomsUseCase(
                repository: roomRepository
            ),
            houseID: session.currentHouse.id,
            requestingUserID: session.currentUser.id,
            draft: draft
        )
    }

    func makeRoomEditorViewModel(
        session: AppSession,
        onCreated: (@MainActor (Room) async -> Void)? = nil
    ) -> RoomEditorViewModel {
        RoomEditorViewModel(
            createRoom: CreateRoomUseCase(
                roomRepository: roomRepository,
                houseRepository: houseRepository,
                calendar: calendar
            ),
            houseID: session.currentHouse.id,
            creatorUserID: session.currentUser.id,
            getMembers: GetHouseMembersUseCase(
                repository: houseRepository
            ),
            onCreated: onCreated
        )
    }

    // MARK: - Troca de tarefas

    func makeTaskSwapViewModel(
        offeredOccurrenceID: TaskOccurrence.ID,
        session: AppSession
    ) -> TaskSwapViewModel {
        TaskSwapViewModel(
            getMyTasks: GetMyTasksUseCase(
                repository: taskRepository
            ),
            getCandidates: GetTaskSwapCandidatesUseCase(
                repository: taskSwapRepository
            ),
            createRequest: CreateTaskSwapRequestUseCase(
                repository: taskSwapRepository
            ),
            userID: session.currentUser.id,
            houseID: session.currentHouse.id,
            offeredOccurrenceID: offeredOccurrenceID
        )
    }
}
