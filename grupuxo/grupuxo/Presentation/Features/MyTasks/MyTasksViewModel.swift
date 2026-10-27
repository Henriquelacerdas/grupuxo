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
    @Published private(set) var isCompleting = false
    @Published private(set) var state: MyTasksState = .idle
    
    private let getMyTasks: GetMyTasksUseCase
    private let completeTask: CompleteTaskUseCase
    
    private let userID: User.ID
    private let houseID: House.ID
    
    var reminders: [AppReminder] = []
    var authorizationStatus: EKAuthorizationStatus = .notDetermined
    var errorMessage: String?
    var isLoading = false
    
    let eventStore = EKEventStore()
    var eventStoreAccess: EKEventStore { eventStore }
    
    init(
        getMyTasks: GetMyTasksUseCase,
        completeTask: CompleteTaskUseCase,
        userID: User.ID,
        houseID: House.ID
    ) {
        self.getMyTasks = getMyTasks
        self.completeTask = completeTask
        self.userID = userID
        self.houseID = houseID
    }
    
    func load(showLoading: Bool = true) async {
        if showLoading { state = .loading }
        
        do {
            let tasks = try await getMyTasks(
                userID: userID,
                houseID: houseID
            )
            
            state = tasks.isEmpty
            ? .empty
            : .content(tasks)
            
            if case let .content(loadedTasks) = state {
                await requestAccess()
                await syncReminders(for: loadedTasks)
            }
            
        } catch {
            print("Erro ao carregar MyTasks: \(error)")
            state = .failure(
                error.localizedDescription
            )
        }
    }
    
    func canComplete(
        _ item: TaskItem
    ) -> Bool {
        
        !isCompleting
        && item.assignment?.userID == userID
        && item.occurrence.availableAt <= .now
    }
    
    func canRequestSwap(
        _ item: TaskItem
    ) -> Bool {
        
        guard let assignment = item.assignment else {
            return false
        }
        
        return assignment.isActive
        && assignment.userID == userID
        && item.occurrence.availableAt <= .now
    }
    
    func complete(
        _ occurrenceID: TaskOccurrence.ID
    ) async {
        
        guard !isCompleting else {
            return
        }
        
        guard case let .content(tasks) = state,
              let item = tasks.first(where: { $0.id == occurrenceID }),
              canComplete(item) else { return }
        isCompleting = true
        
        defer {
            isCompleting = false
        }
        
        do {
            try await completeTask(
                occurrenceID: occurrenceID,
                userID: userID,
                isCompleted: !item.occurrence.isCompleted
            )
            
            await load(showLoading: false)
            
        } catch {
            actionError = error.localizedDescription
        }
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

