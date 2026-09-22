// Composition root. Future room-management and vacation screens can consume the
// transactional membership/schedule use cases without constructing services in Views.

import Foundation

@MainActor
final class AppContainer {

    let store: MockStore

    let houseRepository: any HouseRepository
    let roomRepository: any RoomRepository
    let taskRepository: any TaskRepository

    init(store: MockStore = MockStore(), calendar: Calendar = Calendar(identifier: .gregorian)) {
        self.store = store
        houseRepository = MockHouseRepository(store: store)
        roomRepository = MockRoomRepository(store: store)
        let distribution = TaskDistributionEngine(optimizer: HungarianAlgorithm())
        let scheduling = TaskSchedulingService(distribution: distribution, fairness: FairnessCalculator(),
                                               rotation: RotationCalculator(), calendar: calendar)
        taskRepository = MockTaskRepository(store: store, scheduling: scheduling)
    }

    func makeProfileViewModel(session: AppSession) -> ProfileViewModel {
        ProfileViewModel(getMembers: GetHouseMembersUseCase(repository: houseRepository),
                         houseID: session.currentHouse.id, currentUserID: session.currentUser.id)
    }

    func makeAddRoomMemberUseCase() -> AddRoomMemberUseCase {
        AddRoomMemberUseCase(repository: taskRepository)
    }

    func makeRefreshTaskScheduleUseCase() -> RefreshTaskScheduleUseCase {
        RefreshTaskScheduleUseCase(repository: taskRepository)
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
            roomRepository: roomRepository,
            getRoomTasks: GetRoomTasksUseCase(
                repository: taskRepository
            ),
            completeTask: CompleteTaskUseCase(repository: taskRepository),
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
            completeTask: CompleteTaskUseCase(repository: taskRepository),
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

        return TaskEditorViewModel(
            createTask: CreateTaskUseCase(
                repository: taskRepository,
                roomRepository: roomRepository
            ),
            getHouseRooms: GetHouseRoomsUseCase(
                repository: roomRepository
            ),
            houseID: session.currentHouse.id,
            ownerUserID: session.currentUser.id,
            draft: draft
        )
    }

    func makeRoomEditorViewModel(
        session: AppSession
    ) -> RoomEditorViewModel {

        RoomEditorViewModel(
            createRoom: CreateRoomUseCase(
                roomRepository: roomRepository,
                houseRepository: houseRepository
            ),
            houseID: session.currentHouse.id,
            creatorUserID: session.currentUser.id
        )
    }
}
