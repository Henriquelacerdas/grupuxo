// GUIA — Tarefa avulsa usa o fluxo de esporádicas já existente: criar pelo editor
// em Gerenciar casa, aparecer neste card, assumir e depois concluir em Minhas tarefas.
// TODO: atualizar o card após cadastro/devolução e validar que tarefas de cômodos
// privados só apareçam para participantes autorizados. Não enviar avulsas para
// a distribuição periódica. A regra de pulo após conclusão descrita em DESCRICAO.md
// é uma integração posterior com a distribuição; assumir sozinho não concede pulo.
import Combine
import Foundation

@MainActor
final class SporadicTasksViewModel: ObservableObject {

    @Published var actionError: String?

    @Published private(set)
    var isCompleting = false

    @Published private(set)
    var isSavingChanges = false

    @Published private(set)
    var state: SporadicTasksState = .idle

    // Alterações de atribuição ainda NÃO confirmadas.
    @Published private(set)
    var pendingClaimIDs: Set<TaskOccurrence.ID> = []

    @Published private(set)
    var pendingReleaseIDs: Set<TaskOccurrence.ID> = []

    private let getTasks: GetSporadicTasksUseCase
    private let getRooms: GetHouseRoomsUseCase
    private let getMembers: GetHouseMembersUseCase

    private let claimTask: ClaimSporadicTaskUseCase
    private let releaseTask: ReleaseSporadicTaskUseCase
    private let deleteTask: DeleteSporadicTaskUseCase
    private let completeTask: CompleteTaskUseCase

    private let userID: User.ID
    private let houseID: House.ID

    init(
        getTasks: GetSporadicTasksUseCase,
        getRooms: GetHouseRoomsUseCase,
        getMembers: GetHouseMembersUseCase,
        claimTask: ClaimSporadicTaskUseCase,
        releaseTask: ReleaseSporadicTaskUseCase,
        deleteTask: DeleteSporadicTaskUseCase,
        completeTask: CompleteTaskUseCase,
        userID: User.ID,
        houseID: House.ID
    ) {
        self.getTasks = getTasks
        self.getRooms = getRooms
        self.getMembers = getMembers
        self.claimTask = claimTask
        self.releaseTask = releaseTask
        self.deleteTask = deleteTask
        self.completeTask = completeTask
        self.userID = userID
        self.houseID = houseID
    }

    var hasPendingChanges: Bool {

        !pendingClaimIDs.isEmpty
            || !pendingReleaseIDs.isEmpty
    }

    var hasPendingClaims: Bool {

        !pendingClaimIDs.isEmpty
    }

    var hasPendingReleases: Bool {

        !pendingReleaseIDs.isEmpty
    }

    func load() async {

        state = .loading

        do {

            async let tasksRequest = getTasks(
                houseID: houseID,
                userID: userID
            )

            async let roomsRequest = getRooms(
                houseID: houseID,
                userID: userID
            )

            async let membersRequest = getMembers(
                houseID: houseID,
                userID: userID
            )

            let (tasks, rooms, members) = try await (
                tasksRequest,
                roomsRequest,
                membersRequest
            )

            let validOccurrenceIDs = Set(
                tasks.map(\.id)
            )

            pendingClaimIDs.formIntersection(
                validOccurrenceIDs
            )

            pendingReleaseIDs.formIntersection(
                validOccurrenceIDs
            )

            guard !tasks.isEmpty else {
                state = .empty
                return
            }

            let roomsByID = Dictionary(
                uniqueKeysWithValues:
                    rooms.map { ($0.id, $0) }
            )

            let membersByID = Dictionary(
                uniqueKeysWithValues:
                    members.map { ($0.id, $0) }
            )

            var items: [SporadicTaskCardItem] = []

            for task in tasks {

                guard let room =
                        roomsByID[task.definition.roomID]
                else {
                    throw DomainError.entityNotFound
                }

                let creator: User?

                if let creatorID =
                    task.definition.createdByUserID {

                    creator =
                        membersByID[creatorID]

                } else {

                    creator = nil
                }

                items.append(
                    SporadicTaskCardItem(
                        task: task,
                        room: room,
                        creator: creator
                    )
                )
            }

            state = .content(items)

        } catch {

            state = .failure(
                error.localizedDescription
            )
        }
    }

    // MARK: - Pending assignment changes

    func claim(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard !isSavingChanges else {
            return
        }

        /*
         Se a tarefa já era minha e eu havia marcado "Desfazer",
         tocar em "Adicionar" novamente simplesmente cancela
         essa alteração pendente.
         */
        if pendingReleaseIDs.remove(
            occurrenceID
        ) != nil {

            return
        }

        /*
         Caso contrário, registramos apenas uma intenção local.
         Nada é enviado ao Repository neste momento.
         */
        pendingClaimIDs.insert(
            occurrenceID
        )
    }

    func release(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard !isSavingChanges else {
            return
        }

        /*
         Se eu acabei de escolher uma tarefa que originalmente
         não era minha, "Desfazer" apenas cancela essa escolha.
         */
        if pendingClaimIDs.remove(
            occurrenceID
        ) != nil {

            return
        }

        /*
         Se a tarefa já estava atribuída a mim quando entrei
         na tela, registramos a intenção de removê-la.
         */
        pendingReleaseIDs.insert(
            occurrenceID
        )
    }

    func discardPendingAssignmentChanges() {

        pendingClaimIDs.removeAll()
        pendingReleaseIDs.removeAll()
    }

    func confirmPendingAssignmentChanges() async -> Bool {

        guard !isSavingChanges else {
            return false
        }

        guard hasPendingChanges else {
            return true
        }

        isSavingChanges = true

        defer {
            isSavingChanges = false
        }

        do {

        
            let releases =
                Array(pendingReleaseIDs)

            let claims =
                Array(pendingClaimIDs)

            /*
             Primeiro removemos atribuições antigas.
             */
            for occurrenceID in releases {

                try await releaseTask(
                    occurrenceID:
                        occurrenceID,
                    userID:
                        userID
                )

                pendingReleaseIDs.remove(
                    occurrenceID
                )
            }

            /*
             Depois gravamos as novas atribuições.
             */
            for occurrenceID in claims {

                try await claimTask(
                    occurrenceID:
                        occurrenceID,
                    userID:
                        userID
                )

                pendingClaimIDs.remove(
                    occurrenceID
                )
            }

            actionError = nil

            await load()

            return true

        } catch {

            actionError =
                error.localizedDescription

            /*
             Recarrega o que realmente foi persistido.
             Se alguma operação anterior ao erro tiver sido
             concluída, a tela volta a refletir o Repository.
             */
            await load()

            return false
        }
    }

    // MARK: - Assignment state shown by the UI

    func canClaim(
        _ item: TaskItem
    ) -> Bool {

        guard !item.occurrence.isCompleted else {
            return false
        }

        /*
         Era minha, mas marquei para desfazer:
         na interface ela passa a poder ser adicionada novamente.
         */
        if pendingReleaseIDs.contains(
            item.id
        ) {

            return true
        }

        /*
         Acabei de escolhê-la:
         ela já aparece localmente como atribuída a mim.
         */
        if pendingClaimIDs.contains(
            item.id
        ) {

            return false
        }

        return item.assignment == nil
    }

    func canRelease(
        _ item: TaskItem
    ) -> Bool {

        guard !item.occurrence.isCompleted else {
            return false
        }

        /*
         Escolhi esta tarefa nesta sessão:
         ela deve aparecer como "Desfazer".
         */
        if pendingClaimIDs.contains(
            item.id
        ) {

            return true
        }

        /*
         Já marquei a remoção:
         localmente ela não está mais atribuída a mim.
         */
        if pendingReleaseIDs.contains(
            item.id
        ) {

            return false
        }

        return item.assignment?.userID
            == userID
    }

    // MARK: - Ownership

    func wasCreatedByCurrentUser(
        _ item: SporadicTaskCardItem
    ) -> Bool {

        item.task.definition.createdByUserID
            == userID
    }

    // MARK: - Delete

    func delete(
        _ taskDefinitionID: TaskDefinition.ID
    ) async {

        await perform {

            try await deleteTask(
                taskDefinitionID:
                    taskDefinitionID,
                userID:
                    userID
            )
        }
    }

    // MARK: - Complete

    func canComplete(
        _ item: TaskItem
    ) -> Bool {

        !isCompleting
            && !item.occurrence.isCompleted
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= .now
    }

    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard !isCompleting else {
            return
        }

        isCompleting = true

        defer {
            isCompleting = false
        }

        do {

            try await completeTask(
                occurrenceID:
                    occurrenceID,
                userID:
                    userID
            )

            await load()

        } catch {

            actionError =
                error.localizedDescription
        }
    }

    // MARK: - Shared action

    private func perform(
        _ action: () async throws -> Void
    ) async {

        do {

            try await action()

            await load()

        } catch {

            actionError =
                error.localizedDescription
        }
    }
}
