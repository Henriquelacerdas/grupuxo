import Foundation

@MainActor
final class AppContainer {
    let store: MockStore
    private let calendar: Calendar
    let houseRepository: any HouseRepository
    let roomRepository: any RoomRepository
    let taskRepository: any TaskRepository

    init(store: MockStore = MockStore(), calendar: Calendar = Calendar(identifier: .gregorian)) {
        self.store = store
        self.calendar = calendar
        let scheduling = TaskSchedulingService(
            distribution: TaskDistributionEngine(optimizer: HungarianAlgorithm()),
            fairness: FairnessCalculator(), rotation: RotationCalculator(), calendar: calendar
        )
        roomRepository = MockRoomRepository(store: store, scheduling: scheduling)
        houseRepository = MockHouseRepository(store: store, scheduling: scheduling)
        taskRepository = MockTaskRepository(store: store, scheduling: scheduling)
    }

    func makeProfileViewModel(session: AppSession) -> ProfileViewModel {
        ProfileViewModel(
            getMembers: GetHouseMembersUseCase(repository: houseRepository),
            addMember: AddHouseMemberUseCase(repository: houseRepository),
            removeMember: RemoveHouseMemberUseCase(repository: houseRepository),
            houseID: session.currentHouse.id, currentUserID: session.currentUser.id
        )
    }

    func makeAddRoomMemberUseCase() -> AddRoomMemberUseCase {
        AddRoomMemberUseCase(repository: taskRepository)
    }

    func makeRemoveRoomMemberUseCase() -> RemoveRoomMemberUseCase {
        RemoveRoomMemberUseCase(repository: taskRepository)
    }

    func makeRefreshTaskScheduleUseCase() -> RefreshTaskScheduleUseCase {
        RefreshTaskScheduleUseCase(repository: taskRepository)
    }

    func makeMyTasksViewModel(session: AppSession) -> MyTasksViewModel {
        MyTasksViewModel(
            getMyTasks: GetMyTasksUseCase(repository: taskRepository),
            completeTask: CompleteTaskUseCase(repository: taskRepository),
            userID: session.currentUser.id, houseID: session.currentHouse.id
        )
    }

    func makeHouseManagementViewModel(session: AppSession) -> HouseManagementViewModel {
        HouseManagementViewModel(
            getHouseRooms: GetHouseRoomsUseCase(repository: roomRepository),
            houseID: session.currentHouse.id, userID: session.currentUser.id
        )
    }

    func makeRoomDetailViewModel(roomID: Room.ID, session: AppSession) -> RoomDetailViewModel {
        RoomDetailViewModel(
            getParticipation: GetRoomParticipationUseCase(repository: roomRepository),
            addMember: makeAddRoomMemberUseCase(),
            removeMember: makeRemoveRoomMemberUseCase(),
            getRoomTasks: GetRoomTasksUseCase(repository: taskRepository),
            getTaskSuggestions: GetTaskSuggestionsUseCase(catalog: TaskSuggestionCatalog()),
            completeTask: CompleteTaskUseCase(repository: taskRepository),
            roomID: roomID, userID: session.currentUser.id
        )
    }

    func makeSporadicTasksViewModel(session: AppSession) -> SporadicTasksViewModel {
        SporadicTasksViewModel(
            getTasks: GetSporadicTasksUseCase(repository: taskRepository),
            claimTask: ClaimSporadicTaskUseCase(repository: taskRepository),
            releaseTask: ReleaseSporadicTaskUseCase(repository: taskRepository),
            completeTask: CompleteTaskUseCase(repository: taskRepository),
            userID: session.currentUser.id, houseID: session.currentHouse.id
        )
    }

    func makeTaskEditorViewModel(roomID: Room.ID?, session: AppSession) -> TaskEditorViewModel {
        var draft = TaskDraft()
        draft.roomID = roomID
        return makeTaskEditorViewModel(draft: draft, session: session)
    }

    func makeTaskEditorViewModel(
        roomID: Room.ID, suggestion: TaskSuggestion, session: AppSession
    ) -> TaskEditorViewModel {
        var draft = TaskDraft()
        draft.roomID = roomID
        draft.name = suggestion.name
        draft.details = suggestion.details
        draft.effortPoints = suggestion.effort.points
        draft.sourceSuggestionID = suggestion.id
        return makeTaskEditorViewModel(draft: draft, session: session)
    }

    private func makeTaskEditorViewModel(draft: TaskDraft, session: AppSession) -> TaskEditorViewModel {
        TaskEditorViewModel(
            createTask: CreateTaskUseCase(repository: taskRepository, roomRepository: roomRepository),
            getHouseRooms: GetHouseRoomsUseCase(repository: roomRepository),
            houseID: session.currentHouse.id, requestingUserID: session.currentUser.id, draft: draft
        )
    }

    func makeRoomEditorViewModel(session: AppSession) -> RoomEditorViewModel {
        RoomEditorViewModel(
            createRoom: CreateRoomUseCase(
                roomRepository: roomRepository, houseRepository: houseRepository, calendar: calendar
            ),
            houseID: session.currentHouse.id, creatorUserID: session.currentUser.id,
            getMembers: GetHouseMembersUseCase(repository: houseRepository)
        )
    }
}
