// GUIA — Montar aqui as dependências das próximas entregas.
// TODO: injetar CreateRoomUseCase e o futuro caso de uso de distribuição/rotação,
// compartilhando este MockStore. Criar as fábricas dos novos ViewModels.
// Coordenar atualização semanal ao abrir/retomar o app e após mudanças de
// participantes/férias. Reprocessar a mesma semana deve ser seguro. Execução com
// o app fechado exige estratégia futura de agendamento/backend; um timer de View
// não garante a rotação automática. Calendário e data devem chegar aos calculadores.

@MainActor
final class AppContainer {

    let store: MockStore

    let houseRepository: any HouseRepository

    let roomRepository: any RoomRepository

    let taskRepository: any TaskRepository

    init(store: MockStore = MockStore()) {

        self.store = store

        houseRepository = MockHouseRepository(store: store)

        roomRepository = MockRoomRepository(store: store)

        taskRepository = MockTaskRepository(store: store)
    }

    func makeMyTasksViewModel(session: AppSession) -> MyTasksViewModel {

        MyTasksViewModel(
            getMyTasks: GetMyTasksUseCase(repository: taskRepository),
            completeTask: CompleteTaskUseCase(repository: taskRepository),
            userID: session.currentUser.id,
            houseID: session.currentHouse.id
        )
    }

    func makeHouseManagementViewModel(session: AppSession) -> HouseManagementViewModel {

        HouseManagementViewModel(
            getHouseRooms: GetHouseRoomsUseCase(repository: roomRepository),
            houseID: session.currentHouse.id
        )
    }

    func makeRoomDetailViewModel(roomID: Room.ID, session: AppSession) -> RoomDetailViewModel {

        RoomDetailViewModel(
            roomRepository: roomRepository,
            getRoomTasks: GetRoomTasksUseCase(repository: taskRepository),
            roomID: roomID,
            userID: session.currentUser.id
        )
    }

    func makeSporadicTasksViewModel(session: AppSession) -> SporadicTasksViewModel {

        SporadicTasksViewModel(
            getTasks: GetSporadicTasksUseCase(repository: taskRepository),
            claimTask: ClaimSporadicTaskUseCase(repository: taskRepository),
            releaseTask: ReleaseSporadicTaskUseCase(repository: taskRepository),
            userID: session.currentUser.id,
            houseID: session.currentHouse.id
        )
    }

    func makeTaskEditorViewModel(roomID: Room.ID?, session: AppSession) -> TaskEditorViewModel {

        var draft = TaskDraft()
        draft.roomID = roomID

        return TaskEditorViewModel(
            createTask: CreateTaskUseCase(repository: taskRepository),
            getHouseRooms: GetHouseRoomsUseCase(repository: roomRepository),
            houseID: session.currentHouse.id,
            ownerUserID: session.currentUser.id,
            draft: draft
        )
    }

    func makeRoomEditorViewModel(session: AppSession) -> RoomEditorViewModel {

        RoomEditorViewModel(
            createRoom: CreateRoomUseCase(
                roomRepository: roomRepository,
                houseRepository: houseRepository
            ),
            houseID: session.currentHouse.id
        )
    }
}
