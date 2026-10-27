import Combine
import Foundation
import GrupuxoDomain
import EventKit

struct AppReminder: Identifiable, Sendable {
    let id: String // reminder.calendarItemIdentifier
    let title: String
    let notes: String?
    let dueDate: Date?
    let isCompleted: Bool
    let priority: Int
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
                await requestAccess()
                await syncReminders(for: loadedTasks.allItems)
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
    
    func syncReminders(for tasks: [TaskItem]) async {
        if authorizationStatus == .fullAccess {
            await fetchReminders()
        }
        
        for item in tasks {
            // Evita criar duplicatas caso o lembrete já exista
            let alreadyExists = reminders.contains { reminder in
                reminder.title == item.definition.name
            }
            
            if !alreadyExists {
                _ = await createReminder(
                    title: item.definition.name,
                    dueDate: item.occurrence.dueAt,
                    priority: 0,
                    notes: item.definition.details.isEmpty ? nil : item.definition.details
                )
            }
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
        notes: String? = nil
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
    
    func fetchReminders(showCompleted: Bool = false) async {
        checkAuthorizationStatus()
            
        guard authorizationStatus == .fullAccess else {
            print("⚠️ fetchReminders abortado: Permissão .fullAccess ainda não concedida.")
            reminders = []
            return
        }
        
        isLoading = true
        
        let predicate: NSPredicate = showCompleted
        ? eventStore.predicateForReminders(in: nil)
        : eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        
        let fetchedReminders: [AppReminder] = await withUnsafeContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { ekReminders in
                guard let ekReminders else {
                    continuation.resume(returning: [])
                    return
                }
                
                let mappedItems = ekReminders.map { ek -> AppReminder in
                    AppReminder(
                        id: ek.calendarItemIdentifier,
                        title: ek.title ?? "",
                        notes: ek.notes,
                        dueDate: ek.dueDateComponents?.date,
                        isCompleted: ek.isCompleted,
                        priority: ek.priority
                    )
                }
                continuation.resume(returning: mappedItems)
            }
        }
        
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
