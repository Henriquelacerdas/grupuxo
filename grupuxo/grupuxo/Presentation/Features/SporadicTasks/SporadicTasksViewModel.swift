// GUIA — Tarefa avulsa usa o fluxo de esporádicas já existente: criar pelo editor
// em Gerenciar casa, aparecer neste card, assumir e depois concluir em Minhas tarefas.
// TODO: atualizar o card após cadastro/devolução e validar que tarefas de cômodos
// privados só apareçam para participantes autorizados. Não enviar avulsas para
// a distribuição periódica. A regra de pulo após conclusão descrita em DESCRICAO.md
// é uma integração posterior com a distribuição; assumir sozinho não concede pulo.
import Combine
import Foundation
import GrupuxoDomain

@MainActor
final class SporadicTasksViewModel: ObservableObject {

    @Published var actionError: String?

    @Published private var completions = OptimisticTaskCompletions()
    var isCompleting: Bool { completions.isCompleting }
    private var loadID: UUID?

    @Published private(set)
    var isSavingChanges = false

    @Published private(set)
    var state: SporadicTasksState = .idle

    // Alterações de atribuição ainda NÃO confirmadas.
    @Published private(set)
    var pendingClaimIDs: Set<TaskOccurrence.ID> = []

    @Published private(set)
    var pendingReleaseIDs: Set<TaskOccurrence.ID> = []

    /// Cômodos de que o morador participa (só eles deixam adicionar a tarefa: o servidor recusa os demais).
    /// `nil` = não deu para saber; então a tela não bloqueia, e o servidor decide.
    @Published private(set)
    var memberRoomIDs: Set<Room.ID>?

    private let getTasks: GetSporadicTasksUseCase
    private let getRooms: GetHouseRoomsUseCase
    private let getMembers: GetHouseMembersUseCase

    private let claimTask: ClaimSporadicTaskUseCase
    private let releaseTask: ReleaseSporadicTaskUseCase
    private let deleteTask: DeleteSporadicTaskUseCase
    private let completeTask: CompleteTaskUseCase

    private let userID: User.ID
    private let houseID: House.ID

    private let refreshData: @Sendable () async -> Void

    init(
        refreshData: @escaping @Sendable () async -> Void = {},
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
        self.refreshData = refreshData
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

    func load(forceRefresh: Bool = false) async {
        if forceRefresh { await refreshData() }

        if case .content = state {} else if case .empty = state {} else { state = .loading }
        let id = UUID()
        loadID = id
        let revision = completions.revision
        do {

            async let tasksRequest = getTasks(
                houseID: houseID,
                userID: userID
            )

            async let roomsRequest = getRooms(
                houseID: houseID,
                userID: userID
            )

            async let memberRoomsRequest = try? getRooms(
                houseID: houseID,
                userID: userID,
                participatingOnly: true
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
            let memberRooms = await memberRoomsRequest

            try Task.checkCancellation()
            guard loadID == id, completions.revision == revision else { return }
            completions.acceptReload()
            memberRoomIDs = memberRooms.map { Set($0.map(\.id)) }
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
                        task: completions.applying(to: task),
                        room: room,
                        creator: creator
                    )
                )
            }

            state = .content(items)

        } catch is CancellationError {
            // A tela saiu antes da resposta.
        } catch {

            guard loadID == id, completions.revision == revision else { return }
            if case .content = state {
                actionError = error.localizedDescription
                return
            }
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

        return item.assignment == nil && isRoomMember(item)
    }

    /// O morador participa do cômodo da tarefa (ou não deu para saber).
    func isRoomMember(
        _ item: TaskItem
    ) -> Bool {

        memberRoomIDs?.contains(item.definition.roomID) ?? true
    }

    /// Nome de quem já pegou a tarefa, quando é outro morador (e não é uma alteração local ainda não confirmada).
    func takenByAnotherName(
        _ item: TaskItem
    ) -> String? {

        guard !item.occurrence.isCompleted,
              !pendingClaimIDs.contains(item.id),
              !pendingReleaseIDs.contains(item.id),
              let assignment = item.assignment,
              assignment.userID != userID
        else { return nil }

        return item.assignee.map { ResidentNameFormatting.shortName($0.name) }
            ?? String(localized: "Outro morador")
    }

    /// Para quem a tarefa está: "Você" quando é minha (inclusive marcada e ainda não confirmada), o nome de outro morador
    /// ou `nil` quando ninguém a pegou.
    func assigneeName(
        _ item: TaskItem
    ) -> String? {

        if pendingReleaseIDs.contains(item.id) { return nil }

        if pendingClaimIDs.contains(item.id) { return String(localized: "Você") }

        guard let assignment = item.assignment else { return nil }

        if assignment.userID == userID { return String(localized: "Você") }

        return item.assignee.map { ResidentNameFormatting.shortName($0.name) }
            ?? String(localized: "Outro morador")
    }

    /// Marquei "Adicionar" e ainda não confirmei (✓).
    func isPendingClaim(
        _ item: TaskItem
    ) -> Bool {

        pendingClaimIDs.contains(item.id)
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

    /// Editar e apagar: a tarefa é de quem a criou; sem criador conhecido (criada antes do campo, ou o criador saiu da
    /// casa) ela não teria dono, então qualquer morador pode (mesma regra do servidor).
    func canManage(
        _ item: SporadicTaskCardItem
    ) -> Bool {

        wasCreatedByCurrentUser(item) || item.creator == nil
    }

    func wasCreatedByCurrentUser(
        _ item: SporadicTaskCardItem
    ) -> Bool {

        item.task.definition.createdByUserID
            == userID
    }

    // MARK: - Delete

    @discardableResult
    func delete(
        _ taskDefinitionID: TaskDefinition.ID
    ) async -> Bool {

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

        // Concluída continua acionável pelo responsável: concluir alterna, como em Minhas tarefas e no cômodo.
        !isSavingChanges && !completions.pendingIDs.contains(item.id)
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= .now
    }

    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {

        guard case let .content(items) = state,
              let item = items.first(where: { $0.task.id == occurrenceID })?.task,
              canComplete(item) else { return }
        completions.begin(item, by: userID)
        presentCompletions()
        do {
            try await completeTask(
                occurrenceID: occurrenceID, userID: userID, isCompleted: !item.occurrence.isCompleted
            )
            completions.finish(occurrenceID)
        } catch {
            completions.finish(occurrenceID, restoring: item)
            presentCompletions()
            actionError = error.localizedDescription
        }
        if !completions.isCompleting { await load() }
    }

    private func presentCompletions() {
        guard case let .content(items) = state else { return }
        state = .content(items.map {
            SporadicTaskCardItem(task: completions.applying(to: $0.task), room: $0.room, creator: $0.creator)
        })
    }

    // MARK: - Shared action

    @discardableResult
    private func perform(
        _ action: () async throws -> Void
    ) async -> Bool {

        do {

            try await action()

            await load()

            return true

        } catch {

            actionError =
                error.localizedDescription

            return false
        }
    }
}
