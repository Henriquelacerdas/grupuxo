import Foundation
import GrupuxoDomain

@MainActor
final class AppContainer {

    /// Estado em memória do container de testes e pré-visualizações; no container da `api` fica vazio e sem uso.
    let store: MockStore
    private let calendar: Calendar

    let houseRepository: any HouseRepository
    let roomRepository: any RoomRepository
    let taskRepository: any TaskRepository
    let roomAccessRequestRepository: any RoomAccessRequestRepository

    let taskSwapRepository: any TaskSwapRepository
    let notificationRepository: any NotificationRepository
    let whatsAppConnectionRepository: any WhatsAppConnectionRepository

    private init(
        store: MockStore,
        calendar: Calendar,
        houseRepository: any HouseRepository,
        roomRepository: any RoomRepository,
        taskRepository: any TaskRepository,
        roomAccessRequestRepository: any RoomAccessRequestRepository,
        taskSwapRepository: any TaskSwapRepository,
        notificationRepository: any NotificationRepository,
        whatsAppConnectionRepository: any WhatsAppConnectionRepository
    ) {
        self.store = store
        self.calendar = calendar
        self.houseRepository = houseRepository
        self.roomRepository = roomRepository
        self.taskRepository = taskRepository
        self.roomAccessRequestRepository = roomAccessRequestRepository
        self.taskSwapRepository = taskSwapRepository
        self.notificationRepository = notificationRepository
        self.whatsAppConnectionRepository = whatsAppConnectionRepository
    }

    /// Container sobre a `api` do servidor: casa, cômodos, tarefas, trocas, notificações e WhatsApp são reais.
    convenience init(api: APIClient, calendar: Calendar = Calendar(identifier: .gregorian)) {
        // Um só `GET /v1/me/house` para casa, moradores e cômodos.
        let myHouse = MyHouseCache(api: api)
        self.init(
            store: MockStore(state: MockSeed.empty()),
            calendar: calendar,
            houseRepository: RemoteHouseRepository(api: api, myHouse: myHouse),
            roomRepository: RemoteRoomRepository(api: api, myHouse: myHouse),
            taskRepository: RemoteTaskRepository(api: api, myHouse: myHouse),
            roomAccessRequestRepository: RemoteRoomAccessRequestRepository(),
            taskSwapRepository: RemoteTaskSwapRepository(api: api),
            notificationRepository: RemoteNotificationRepository(api: api),
            whatsAppConnectionRepository: RemoteWhatsAppConnectionRepository(api: api)
        )
    }

    /// Container sobre o `MockStore` em memória (testes e pré-visualizações).
    convenience init(
        store: MockStore = MockStore(),
        calendar: Calendar = Calendar(identifier: .gregorian)
    ) {
        let scheduling = TaskSchedulingService(
            distribution: TaskDistributionEngine(
                optimizer: HungarianAlgorithm()
            ),
            fairness: FairnessCalculator(),
            rotation: RotationCalculator(),
            calendar: calendar
        )
        self.init(
            store: store,
            calendar: calendar,
            houseRepository: MockHouseRepository(store: store, scheduling: scheduling),
            roomRepository: MockRoomRepository(store: store, scheduling: scheduling),
            taskRepository: MockTaskRepository(store: store, scheduling: scheduling),
            roomAccessRequestRepository: MockRoomAccessRequestRepository(store: store),
            taskSwapRepository: MockTaskSwapRepository(store: store),
            notificationRepository: MockNotificationRepository(store: store),
            whatsAppConnectionRepository: MockWhatsAppConnectionRepository()
        )
    }

    func makeWhatsAppConnectionViewModel() -> WhatsAppConnectionViewModel {
        WhatsAppConnectionViewModel(
            getConnection: GetWhatsAppConnectionUseCase(
                repository: whatsAppConnectionRepository
            ),
            createInvitation: CreateWhatsAppInvitationUseCase(
                repository: whatsAppConnectionRepository
            ),
            disconnect: DisconnectWhatsAppUseCase(
                repository: whatsAppConnectionRepository
            )
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
            getMyTasksOverview: GetMyTasksOverviewUseCase(
                roomRepository: roomRepository,
                taskRepository: taskRepository
            ),
            completeTask: CompleteTaskUseCase(
                repository: taskRepository
            ),
            endTask: EndTaskUseCase(
                repository: taskRepository
            ),
            user: session.currentUser,
            houseName: session.currentHouse.name,
            houseID: session.currentHouse.id,
            calendar: calendar
        )
    }

    func makeHouseManagementViewModel(
        session: AppSession
    ) -> HouseManagementViewModel {
        HouseManagementViewModel(
            getHouseOverview: GetHouseOverviewUseCase(
                roomRepository: roomRepository,
                taskRepository: taskRepository,
                accessRequestRepository: roomAccessRequestRepository
            ),
            requestRoomAccess: RequestRoomAccessUseCase(
                repository: roomAccessRequestRepository
            ),
            cancelRoomAccessRequest: CancelRoomAccessRequestUseCase(
                repository: roomAccessRequestRepository
            ),
            houseName: session.currentHouse.name,
            houseID: session.currentHouse.id,
            userID: session.currentUser.id,
            calendar: calendar
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
            endTask: EndTaskUseCase(
                repository: taskRepository
            ),
            claimTask: ClaimSporadicTaskUseCase(
                repository: taskRepository
            ),
            roomID: roomID,
            userID: session.currentUser.id,
            calendar: calendar
        )
    }

    func makeSporadicTasksViewModel(
        session: AppSession
    ) -> SporadicTasksViewModel {

        SporadicTasksViewModel(
            getTasks:
                GetSporadicTasksUseCase(
                    repository: taskRepository
                ),
            getRooms:
                GetHouseRoomsUseCase(
                    repository: roomRepository
                ),
            getMembers:
                GetHouseMembersUseCase(
                    repository: houseRepository
                ),
            claimTask:
                ClaimSporadicTaskUseCase(
                    repository: taskRepository
                ),
            releaseTask:
                ReleaseSporadicTaskUseCase(
                    repository: taskRepository
                ),
            deleteTask:
                DeleteSporadicTaskUseCase(
                    repository: taskRepository
                ),
            completeTask:
                CompleteTaskUseCase(
                    repository: taskRepository
                ),
            userID:
                session.currentUser.id,
            houseID:
                session.currentHouse.id
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

    func makeTaskDetailViewModel(
        taskDefinitionID: TaskDefinition.ID,
        session: AppSession
    ) -> TaskDetailViewModel {

        TaskDetailViewModel(
            getTaskDefinition: GetTaskDefinitionUseCase(
                repository: taskRepository
            ),
            updateTaskDetails: UpdateTaskDetailsUseCase(
                repository: taskRepository
            ),
            getUpcomingAssignments: GetTaskUpcomingAssignmentsUseCase(
                repository: taskRepository
            ),
            taskDefinitionID: taskDefinitionID,
            userID: session.currentUser.id
        )

    }

    func makeRoomEditorViewModel(
        session: AppSession,
        onCreated: (@MainActor (Room) async throws -> Void)? = nil
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
    func makeNotificationsViewModel(
        session: AppSession
    ) -> NotificationsViewModel {

        NotificationsViewModel(
            getNotifications:
                GetNotificationsUseCase(
                    repository:
                        notificationRepository
                ),
            markNotificationAsRead:
                MarkNotificationAsReadUseCase(
                    repository:
                        notificationRepository
                ),
            getIncomingSwaps:
                GetIncomingTaskSwapRequestsUseCase(
                    repository: taskSwapRepository
                ),
            acceptSwap:
                AcceptTaskSwapRequestUseCase(
                    repository: taskSwapRepository
                ),
            rejectSwap:
                RejectTaskSwapRequestUseCase(
                    repository: taskSwapRepository
                ),
            getMyTasks:
                GetMyTasksUseCase(
                    repository: taskRepository
                ),
            getSwapCandidates:
                GetTaskSwapCandidatesUseCase(
                    repository: taskSwapRepository
                ),
            getMembers:
                GetHouseMembersUseCase(
                    repository: houseRepository
                ),
            userID:
                session.currentUser.id,
            houseID:
                session.currentHouse.id
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
