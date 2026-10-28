import Combine
import Foundation
import GrupuxoDomain
@preconcurrency import EventKit

struct AppReminder: Identifiable, Sendable {
    let id: String // reminder.calendarItemIdentifier
    let title: String
    let notes: String?
    let dueDate: Date?
    let isCompleted: Bool
    let priority: Int
    /// Ocorrência do app a que o lembrete está vinculado (guardada na URL do lembrete).
    let occurrenceID: UUID?
}

@MainActor
final class MyTasksViewModel: ObservableObject {
    
    @Published var actionError: String?
    @Published private var completions = OptimisticTaskCompletions()
    var isCompleting: Bool { completions.isCompleting }
    private var overview: MyTasksOverview?
    private var loadID: UUID?
    @Published private(set) var state: MyTasksState = .idle
    
//    private let getMyTasks: GetMyTasksUseCase
    private let completeTask: CompleteTaskUseCase
    
    private let houseID: House.ID
    
    var reminders: [AppReminder] = []
    var authorizationStatus: EKAuthorizationStatus = .notDetermined
    var errorMessage: String?
    var isLoading = false
    private var reminderSyncTask: Task<Void, Never>?
    private var needsReminderResync = false
    /// Ocorrências cuja propagação Lembretes → app falhou nesta sessão; não reinsiste (evita laço de erros).
    private var failedReminderKeys = Set<String>()
    private var knownStatesKey: String { "reminderSync.completion.\(userID.uuidString)" }
    /// Último estado (concluído ou não) em que lembrete e app estavam de acordo, por ocorrência.
    /// É o que permite saber QUEM mudou: se o lembrete difere disto, foi mudado no app Lembretes.
    private var knownReminderStates: [String: Bool] {
        get { UserDefaults.standard.dictionary(forKey: knownStatesKey) as? [String: Bool] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: knownStatesKey) }
    }
    private enum SyncDirection { case none, reminderToApp, appToReminder }
    private var cancellables = Set<AnyCancellable>()
    
    let eventStore = EKEventStore()
    var eventStoreAccess: EKEventStore { eventStore }
    
    let user: User
    let houseName: String

    private let getMyTasksOverview: GetMyTasksOverviewUseCase
    private let endTask: EndTaskUseCase

    private let now: () -> Date
    private let calendar: Calendar
    private let text: MyTasksText

    private var userID: User.ID { user.id }

    private let refreshData: @Sendable () async -> Void

    init(
        refreshData: @escaping @Sendable () async -> Void = {},
        getMyTasksOverview: GetMyTasksOverviewUseCase,
        completeTask: CompleteTaskUseCase,
        endTask: EndTaskUseCase,
        user: User,
        houseName: String,
        houseID: House.ID,
        now: @escaping () -> Date = { .now },
        calendar: Calendar = .current,
        locale: Locale = HouseOverviewText.appLocale
    ) {
        self.refreshData = refreshData
        self.getMyTasksOverview = getMyTasksOverview
        self.completeTask = completeTask
        self.endTask = endTask
        self.user = user
        self.houseName = houseName
        self.houseID = houseID
        self.now = now
        self.calendar = calendar
        self.text = MyTasksText(calendar: calendar, locale: locale)

        // Concluir/editar no app Lembretes dispara esta notificação (ao vivo ou ao voltar pro app).
        NotificationCenter.default
            .publisher(for: .EKEventStoreChanged, object: eventStore)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.reminderStoreDidChange() }
            .store(in: &cancellables)
    }
    
    func load(showLoading: Bool = true, forceRefresh: Bool = false) async {
        if forceRefresh { await refreshData() }

        // Recarregar não esvazia a tela: o conteúdo atual fica até o novo chegar.
        if showLoading {
            if case .content = state {} else {
                state = .loading
            }
        }

        let id = UUID()
        loadID = id
        let revision = completions.revision
        do {
            let date = now()

            let overview = try await getMyTasksOverview(
                houseID: houseID,
                userID: userID,
                at: date,
                calendar: calendar
            )
            
            let content = content(from: overview, at: date)
            state = content.allItems.isEmpty ? .empty : .content(content)
            
            if case let .content(loadedTasks) = state {
                scheduleReminderSync(for: reminderEligibleItems(in: loadedTasks))
            }

            try Task.checkCancellation()
            guard loadID == id, completions.revision == revision else { return }
            self.overview = overview
            completions.acceptReload()
            presentOverview(at: date)

        } catch is CancellationError {
            // A tela saiu antes da resposta: fica o que já estava.
        } catch {
            guard loadID == id, completions.revision == revision else { return }
            // Recarga em segundo plano que falha não troca a lista pela tela de erro.
            if !showLoading, state.hasLoaded { return }
            state = .failure(
                error.localizedDescription
            )
        }
    }
    
    func canComplete(
        _ item: TaskItem
    ) -> Bool {
        !completions.pendingIDs.contains(item.id)
            && item.assignment?.userID == userID
            && item.occurrence.availableAt <= now()
    }
    
    func canRequestSwap(
        _ item: TaskItem
    ) -> Bool {
        
        guard let assignment = item.assignment else {
            return false
        }
        
        return !completions.pendingIDs.contains(item.id)
            && !item.occurrence.isCompleted
            && assignment.isActive
            && assignment.userID == userID
            && item.occurrence.availableAt <= now()
    }

    /// Só tarefas recorrentes ainda ativas podem ser encerradas; avulsas não têm exclusão na `api`.
    func canEnd(
        _ item: TaskItem
    ) -> Bool {

        item.definition.kind == .recurring
            && item.definition.endedAt == nil
    }

    /// Encerra a tarefa: o histórico fica e a ocorrência da vez continua até ser concluída.
    @discardableResult
    func end(
        taskID: TaskDefinition.ID
    ) async -> Bool {

        do {
            try await endTask(
                taskID: taskID,
                requestedBy: userID,
                at: now()
            )

            await load(showLoading: false)
            return true

        } catch {
            actionError = error.localizedDescription
            return false
        }
    }
    
    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {
        
        guard !completions.isCompleting else {
            return
        }
        
        guard case let .content(tasks) = state,
              let item = tasks.allItems.first(where: { $0.id == occurrenceID }),
              canComplete(item) else { return }
        
        completions.begin(item, by: userID, at: now())
        presentOverview(at: now())

        do {
            try await completeTask(
                occurrenceID: occurrenceID, userID: userID,
                isCompleted: !item.occurrence.isCompleted
            )
            await load(showLoading: false)
            completions.finish(occurrenceID)
        } catch {
            completions.finish(occurrenceID, restoring: item)
            presentOverview(at: now())
            actionError = error.localizedDescription
        }
        // Outras linhas continuam acionáveis; só a última escrita dispara a reconciliação.
        if !completions.isCompleting { await load(showLoading: false) }
    }

    private func presentOverview(at date: Date) {
        guard let overview else { return }
        let displayed = completions.applying(to: overview)
        let contentToPresent = content(from: displayed, at: date)
        state = contentToPresent.allItems.isEmpty ? .empty : .content(contentToPresent)
    }

    // MARK: - Apresentação

    private func content(
        from overview: MyTasksOverview,
        at date: Date
    ) -> MyTasksContent {

        MyTasksContent(
            cycles: overview.cycleGroups.map { group in

                MyTasksContent.Cycle(
                    id: group.room.id,
                    roomName: group.room.name,
                    color: group.room.color,
                    status: text.cycleStatus(
                        periodEnd: group.periodEnd,
                        progress: group.progress,
                        now: date
                    ),
                    spokenStatus: text.cycleStatusSpoken(
                        periodEnd: group.periodEnd,
                        progress: group.progress,
                        now: date
                    ),
                    rows: group.tasks.map {
                        MyTasksContent.Row(
                            item: $0,
                            roomName: nil,
                            dueDay: nil,
                            color: group.room.color
                        )
                    }
                )
            },
            extras: overview.extraTasks.map { row($0, at: date) },
            sporadics: overview.sporadicTasks.map {
                MyTasksContent.Row(
                    item: $0.item,
                    roomName: $0.room.name,
                    dueDay: nil,
                    color: $0.room.color
                )
            }
        )
    }

    private func row(
        _ task: RoomTask,
        at date: Date
    ) -> MyTasksContent.Row {

        MyTasksContent.Row(
            item: task.item,
            roomName: task.room.name,
            dueDay: task.item.occurrence.dueAt.map {
                text.dueDay($0, now: date)
            },
            color: task.room.color
        )
    }
    
    private func reminderStoreDidChange() {
        guard case let .content(content) = state else { return }
        scheduleReminderSync(for: reminderEligibleItems(in: content))
    }

    /// Só vão para o Lembretes as tarefas do seu ciclo e as únicas que você assumiu.
    /// "Tarefas gerais" (`extras`) ficam de fora.
    private func reminderEligibleItems(in content: MyTasksContent) -> [TaskItem] {
        (content.cycles.flatMap(\.rows) + content.sporadics).map(\.item)
    }

    private func currentItem(_ id: TaskOccurrence.ID) -> TaskItem? {
        guard case let .content(content) = state else { return nil }
        return content.item(id)
    }

    /// No máximo uma sincronização por vez; pedidos que chegam durante uma rodada
    /// viram uma nova rodada ao final (a sincronização é idempotente, então termina).
    private func scheduleReminderSync(for tasks: [TaskItem]) {
        guard reminderSyncTask == nil else {
            needsReminderResync = true
            return
        }
        reminderSyncTask = Task { [weak self] in
            guard let self else { return }
            await self.runReminderSync(for: tasks)
            self.reminderSyncTask = nil
            if self.needsReminderResync {
                self.needsReminderResync = false
                self.reminderStoreDidChange()
            }
        }
    }

    private func runReminderSync(for tasks: [TaskItem]) async {
        checkAuthorizationStatus()
        if authorizationStatus != .fullAccess {
            guard authorizationStatus == .notDetermined else { return } // negado: não insiste
            await requestAccess()
        }
        guard authorizationStatus == .fullAccess else { return }
        eventStore.refreshSourcesIfNecessary()
        await syncReminders(for: tasks)
    }

    func syncReminders(for tasks: [TaskItem]) async {
        guard authorizationStatus == .fullAccess else { return }
        await fetchReminders(showCompleted: true)

        // 1+2) Mantém lembrete e tarefa em acordo, nos dois sentidos, para concluir e reabrir.
        var known = knownReminderStates

        for reminder in reminders {
            guard let id = reminder.occurrenceID,
                  tasks.contains(where: { $0.id == id }),
                  let live = currentItem(id) else { continue }

            let key = id.uuidString
            let appDone = live.occurrence.isCompleted
            let direction: SyncDirection

            if appDone == reminder.isCompleted {
                direction = .none
            } else if let last = known[key] {
                // Quem saiu do último estado combinado foi quem mudou.
                direction = (reminder.isCompleted != last) ? .reminderToApp : .appToReminder
            } else {
                // Sem histórico: o lado "concluído" vence (mantém o comportamento anterior).
                direction = reminder.isCompleted ? .reminderToApp : .appToReminder
            }

            switch direction {
            case .none:
                known[key] = reminder.isCompleted

            case .reminderToApp:
                guard !failedReminderKeys.contains(key), canComplete(live) else { continue }
                actionError = nil // para distinguir uma falha desta chamada de um erro antigo
                await complete(id) // alterna: conclui a aberta ou reabre a concluída
                if currentItem(id)?.occurrence.isCompleted == reminder.isCompleted {
                    known[key] = reminder.isCompleted
                } else if actionError != nil {
                    failedReminderKeys.insert(key)
                }

            case .appToReminder:
                if await setReminderCompleted(reminder, appDone) {
                    known[key] = appDone
                }
            }
        }

        let linked = Set(reminders.compactMap { $0.occurrenceID?.uuidString })
        knownReminderStates = known.filter { linked.contains($0.key) }

        // 3) Cria o que falta (uma vez por ocorrência).
        for item in tasks where !item.occurrence.isCompleted {
            if reminders.contains(where: { $0.occurrenceID == item.id }) { continue }

            // Lembrete criado antes do vínculo existir: adota em vez de duplicar.
            if let legacy = reminders.first(where: {
                $0.occurrenceID == nil && !$0.isCompleted && $0.title == item.definition.name
            }) {
                _ = await linkReminder(legacy, to: item.id)
                continue
            }

            _ = await createReminder(
                title: item.definition.name,
                dueDate: item.occurrence.dueAt,
                priority: 0,
                notes: item.definition.details.isEmpty ? nil : item.definition.details,
                occurrenceID: item.id
            )
        }
    }

    // MARK: - Vínculo lembrete ↔ ocorrência

    private nonisolated static func reminderURL(for occurrenceID: UUID) -> URL? {
        URL(string: "grupuxo://occurrence/\(occurrenceID.uuidString)")
    }

    private nonisolated static func occurrenceID(from url: URL?) -> UUID? {
        guard let url, url.scheme == "grupuxo", url.host == "occurrence" else { return nil }
        return UUID(uuidString: url.lastPathComponent)
    }

    private func linkReminder(_ reminder: AppReminder, to occurrenceID: UUID) async -> Bool {
        guard let ek = eventStore.calendarItem(withIdentifier: reminder.id) as? EKReminder else { return false }
        ek.url = Self.reminderURL(for: occurrenceID)
        do {
            try eventStore.save(ek, commit: true)
            await fetchReminders(showCompleted: true)
            return true
        } catch {
            errorMessage = "Failed to link reminder \(error.localizedDescription)"
            return false
        }
    }

    private func setReminderCompleted(_ reminder: AppReminder, _ completed: Bool) async -> Bool {
        guard let ek = eventStore.calendarItem(withIdentifier: reminder.id) as? EKReminder else { return false }
        ek.isCompleted = completed
        do {
            try eventStore.save(ek, commit: true)
            await fetchReminders(showCompleted: true)
            return true
        } catch {
            errorMessage = "Failed to update reminder \(error.localizedDescription)"
            return false
        }
    }

    func checkAuthorizationStatus() {
        authorizationStatus = EKEventStore.authorizationStatus(for: .reminder)
    }
    
    func requestAccess() async {
        do {
            let granted = try await eventStore.requestFullAccessToReminders()
            
            if granted {
                authorizationStatus = .fullAccess
                await fetchReminders()
            } else {
                authorizationStatus = .denied
                errorMessage = "Acesso ao Lembretes foi negado."
            }
        } catch {
            errorMessage = "Failed to request Access \(error.localizedDescription)"
        }
    }
    
    func createReminder(
        title: String,
        dueDate: Date? = nil,
        priority: Int = 0,
        notes: String? = nil,
        occurrenceID: UUID? = nil
    ) async -> Bool {
        checkAuthorizationStatus()
        
        if authorizationStatus != .fullAccess {
            await requestAccess()
            if authorizationStatus != .fullAccess {
                print("Permissão negada para acessar o app Lembretes.")
                return false
            }
        }
        
        guard let defaultCalendar = eventStore.defaultCalendarForNewReminders() else {
            errorMessage = "Não foi encontrada uma lista padrão de Lembretes no iOS."
            print("Erro: defaultCalendarForNewReminders() é nil.")
            return false
        }
        
        let newReminder = EKReminder(eventStore: eventStore)
        newReminder.title = title
        newReminder.notes = notes
        newReminder.calendar = defaultCalendar
        if let occurrenceID { newReminder.url = Self.reminderURL(for: occurrenceID) }
        
        if let dueDate {
            newReminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
        }
        
        newReminder.priority = priority
        
        do {
            try eventStore.save(newReminder, commit: true)
            await fetchReminders()
            return true
        } catch {
            errorMessage = "Failed to save reminders \(error.localizedDescription)"
            print("Erro ao salvar no EventKit: \(error.localizedDescription)")
            return false
        }
    }
    
    func fetchReminders(showCompleted: Bool = true) async {
        checkAuthorizationStatus()
            
        guard authorizationStatus == .fullAccess else {
            print("⚠️ fetchReminders abortado: Permissão .fullAccess ainda não concedida.")
            reminders = []
            return
        }
        
        isLoading = true
        
        let fetchedReminders = await Self.loadReminders(store: EventStoreBox(store: eventStore), showCompleted: showCompleted)
        
        reminders = fetchedReminders.sorted { first, second in
            switch (first.dueDate, second.dueDate) {
            case let (a?, b?):
                return a < b
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            case (nil, nil):
                return first.title < second.title
            }
        }
        
        isLoading = false
    }
    
    /// EKEventStore não é Sendable; a caixa só atravessa o isolamento para a busca.
    private struct EventStoreBox: @unchecked Sendable {
        let store: EKEventStore
    }

    /// `nonisolated` de propósito: o EventKit chama o completion numa fila em segundo plano.
    /// Um closure criado dentro de um método @MainActor herdaria o isolamento e, no Swift 6,
    /// derrubaria o app com "Incorrect actor executor assumption".
    /// O predicate é criado aqui dentro porque NSPredicate não é Sendable.
    private nonisolated static func loadReminders(
        store box: EventStoreBox,
        showCompleted: Bool
    ) async -> [AppReminder] {
        let store = box.store
        let predicate: NSPredicate = showCompleted
            ? store.predicateForReminders(in: nil)
            : store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)

        return await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { ekReminders in
                let mapped = (ekReminders ?? []).map { ek in
                    AppReminder(
                        id: ek.calendarItemIdentifier,
                        title: ek.title ?? "",
                        notes: ek.notes,
                        dueDate: ek.dueDateComponents?.date,
                        isCompleted: ek.isCompleted,
                        priority: ek.priority,
                        occurrenceID: MyTasksViewModel.occurrenceID(from: ek.url)
                    )
                }
                continuation.resume(returning: mapped)
            }
        }
    }

    func toggleComplete(_ reminder: AppReminder) async -> Bool {
        // Recupera o objeto nativo EKReminder no EventKit usando o id (calendarItemIdentifier)
        guard let ekReminder = eventStore.calendarItem(withIdentifier: reminder.id) as? EKReminder else {
            errorMessage = "Lembrete não encontrado no banco de dados."
            return false
        }
        
        ekReminder.isCompleted = !ekReminder.isCompleted
        
        do {
            try eventStore.save(ekReminder, commit: true)
            await fetchReminders()
            return true
        } catch {
            errorMessage = "Failed to update reminder \(error.localizedDescription)"
            return false
        }
    }
    
    func deleteReminder(_ reminder: AppReminder) async -> Bool {
        // Recupera o objeto nativo EKReminder para remoção
        guard let ekReminder = eventStore.calendarItem(withIdentifier: reminder.id) as? EKReminder else {
            errorMessage = "Lembrete não encontrado no banco de dados."
            return false
        }
        
        do {
            try eventStore.remove(ekReminder, commit: true)
            await fetchReminders()
            return true
        } catch {
            errorMessage = "Failed to delete reminder \(error.localizedDescription)"
            return false
        }
    }
}
