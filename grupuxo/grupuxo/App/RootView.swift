
import SwiftUI
import GrupuxoDomain

@MainActor
struct RootView: View {
    
    @StateObject private var model: RootModel
    
    @ObservedObject private var shortcutManager = ShortcutNavigationManager.shared
    
    @State private var selectedTab: AppTab = .myTasks
    @State private var tasksActivations = 0
    @State private var houseActivations = 0
    
    @State private var tasksPath: [AppRoute] = []
    
    @State private var housePath: [AppRoute] = []
    
    /// Tarefa aberta na sheet de detalhes.
    @State private var presentedTask: PresentedTask?

    /// Ajustes (o perfil), abertos em sheet a partir do avatar de Minhas tarefas.
    @State private var isPresentingProfile = false

    /// "Pedir troca" em sheet, a partir de uma tarefa de Minhas tarefas.
    @State private var swapOffer: SwapOffer?

    /// Ajustes da casa, abertos pelo menu "⋯" da aba Casa.
    @State private var isPresentingHouseSettings = false

    /// Atualiza as listas quando a sheet de detalhes é fechada.
    @State private var taskChanges = 0
    
    init(api: APIClient, user: User, house: House, myHouse: MyHouseCache? = nil) {
        _model = StateObject(
            wrappedValue: RootModel(
                api: api,
                user: user,
                house: house,
                myHouse: myHouse
            )
        )
    }

    /// Raiz sobre um modelo já montado (a casa de demonstração do Debug usa o container do `MockStore`).
    init(model: @autoclosure @escaping () -> RootModel) {
        _model = StateObject(wrappedValue: model())
    }

    private var container: AppContainer {
        model.container
    }
    
    private var session: AppSession {
        model.session
    }
    
    var body: some View {
        tabs
            .toastHost()
            .onChange(
                of: shortcutManager.pendingDestination,
                initial: true
            ) { _, destination in
                
                guard let destination else { return }
                
                switch destination {
                    
                case .myTasks:
                    selectedTab = .myTasks
                    tasksPath = []
                    
                case .house:
                    selectedTab = .house
                    housePath = []
                    
                case .sporadicTasks:
                    selectedTab = .house
                    housePath = [.sporadicTasks]
                }
                
                shortcutManager.pendingDestination = nil
            }
    }

    private var tabs: some View {
        
        TabView(selection: $selectedTab) {
            
            // MARK: - Minhas tarefas
            
            NavigationStack(path: $tasksPath) {
                
                MyTasksView(
                    viewModel: container.makeMyTasksViewModel(
                        session: session
                    ),
                    
                    makeTaskEditorViewModel: {
                        container.makeTaskEditorViewModel(
                            roomID: nil,
                            session: session
                        )
                    },

                    weekRatingViewModel: model.weekRating,

                    onRequestSwap: { occurrenceID in
                        swapOffer = SwapOffer(id: occurrenceID)
                    },
                    
                    onSelectTask: { taskDefinitionID in
                        presentedTask = PresentedTask(
                            id: taskDefinitionID
                        )
                    },
                    
                    onSelectNotifications: {
                        tasksPath.append(.notifications)
                    },
                    
                    onSelectProfile: {
                        isPresentingProfile = true
                    },
                    
                    reloadTrigger: ReloadKey(
                        activation: tasksActivations,
                        taskChanges: taskChanges
                    )
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem {
                Label(
                    "Tarefas",
                    systemImage: "checkmark.circle.fill"
                )
            }
            .tag(AppTab.myTasks)
            
            // MARK: - Gerenciamento da casa
            
            NavigationStack(path: $housePath) {
                
                HouseManagementView(
                    viewModel: container.makeHouseManagementViewModel(
                        session: session
                    ),
                    
                    houseName: session.currentHouse.name,
                    
                    makeTaskEditorViewModel: {
                        container.makeTaskEditorViewModel(
                            roomID: nil,
                            session: session
                        )
                    },
                    
                    makeRoomEditorViewModel: {
                        container.makeRoomEditorViewModel(
                            session: session
                        )
                    },
                    
                    onSelectRoom: { roomID in
                        housePath.append(
                            .roomDetail(roomID)
                        )
                    },
                    
                    onSelectSporadicTasks: {
                        housePath.append(.sporadicTasks)
                    },
                    onOpenHouseSettings: {
                        isPresentingHouseSettings = true
                    },
                    inviteMessage: String(
                        localized: "Entre na casa \"\(session.currentHouse.name)\" no app usando o código: \(session.currentHouse.accessCode)"
                    ),
                    reloadTrigger: ReloadKey(activation: houseActivations, taskChanges: taskChanges)
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem {
                Label(
                    "Casa",
                    systemImage: "house.fill"
                )
            }
            .tag(AppTab.house)
        }
        .onChange(of: selectedTab) { _, tab in
            // Só a aba que voltou a ficar ativa recebe uma nova chave de atualização.
            if tab == .myTasks { tasksActivations += 1 }
            else { houseActivations += 1 }
        }
        .task { await CycleNoticeManager.shared.reschedule() }
        .task(id: taskChanges) { await DailyTasksNoticeManager.shared.reschedule() }
        .sheet(
            item: $presentedTask,
            onDismiss: {
                taskChanges += 1
            }
        ) { task in
            
            TaskDetailView(
                viewModel: container.makeTaskDetailViewModel(
                    taskDefinitionID: task.id,
                    session: session
                ),
                makeEditorViewModel: { definition in
                    container.makeTaskEditorViewModel(
                        editing: definition,
                        session: session
                    )
                },
                makeSwapViewModel: { occurrenceID in
                    container.makeTaskSwapViewModel(
                        offeredOccurrenceID: occurrenceID,
                        session: session
                    )
                }
            )
        }
        .sheet(isPresented: $isPresentingProfile) {

            ProfileView(
                whatsAppViewModel: container.makeWhatsAppConnectionViewModel(),
                accountViewModel: container.makeAccountViewModel(),
                vacationViewModel: container.makeVacationViewModel(session: session),
                appInfo: container.appInfo
            )
        }
        .sheet(isPresented: $isPresentingHouseSettings) {
            HouseSettingsSheet()
        }
        .sheet(
            item: $swapOffer,
            onDismiss: { taskChanges += 1 }
        ) { offer in
            NavigationStack {
                TaskSwapView(
                    viewModel: container.makeTaskSwapViewModel(
                        offeredOccurrenceID: offer.id,
                        session: session
                    )
                )
            }
        }
    }
    
    // MARK: - Destinations
    
    @ViewBuilder
    private func destination(
        for route: AppRoute
    ) -> some View {
        
        switch route {
            
            // MARK: Room Detail
            
            
        case let .roomDetail(roomID):
            
            RoomDetailView(
                viewModel: container.makeRoomDetailViewModel(
                    roomID: roomID,
                    session: session
                ),
                
                makeTaskEditorViewModel: {
                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        session: session
                    )
                },
                
                makeSuggestionEditorViewModel: { suggestion in
                    container.makeTaskEditorViewModel(
                        roomID: roomID,
                        suggestion: suggestion,
                        session: session
                    )
                },

                makeRoomEditorViewModel: { room in
                    container.makeRoomEditorViewModel(
                        editing: room,
                        session: session
                    )
                },

                onSelectTask: { taskDefinitionID in
                    presentedTask = PresentedTask(
                        id: taskDefinitionID
                    )
                },
                reloadTrigger: taskChanges
            )
            
            
            // MARK: Sporadic Tasks
            
        case .sporadicTasks:
            
            SporadicTasksView(
                viewModel: container.makeSporadicTasksViewModel(
                    session: session
                ),
                
                onEditTask: { taskDefinitionID in
                    presentedTask = PresentedTask(
                        id: taskDefinitionID
                    )
                },
                
                reloadTrigger: taskChanges
            )
            
            // MARK: Task Editor
            
        case let .taskEditor(roomID):
            
            TaskEditorView(
                viewModel: container.makeTaskEditorViewModel(
                    roomID: roomID,
                    session: session
                )
            )
            
            // MARK: Task Swap
            
        case let .taskSwap(offeredOccurrenceID):
            
            TaskSwapView(
                viewModel: container.makeTaskSwapViewModel(
                    offeredOccurrenceID: offeredOccurrenceID,
                    session: session
                )
            )
            
            // MARK: Notifications
            
        case .notifications:
            
            NotificationsView(
                viewModel: container.makeNotificationsViewModel(
                    session: session
                ),
                onOpenTask: { taskDefinitionID in
                    presentedTask = PresentedTask(id: taskDefinitionID)
                },
                onOpenRoom: { roomID in
                    if selectedTab == .house {
                        housePath.append(.roomDetail(roomID))
                    } else {
                        tasksPath.append(.roomDetail(roomID))
                    }
                }
            )

        }
    }
}

// MARK: - House Settings

/// Os mesmos Ajustes da casa da tela de Ajustes, em sheet própria a partir da aba Casa.
private struct HouseSettingsSheet: View {

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            HouseSettingsView()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Fechar", systemImage: "xmark") { dismiss() }
                            .labelStyle(.iconOnly)
                    }
                }
        }
    }
}

// MARK: - Swap Offer

/// Tarefa oferecida no pedido de troca aberto em sheet.
private struct SwapOffer: Identifiable {
    let id: TaskOccurrence.ID
}

// MARK: - Presented Task

/// Permite abrir detalhes de uma tarefa em uma sheet.
private struct PresentedTask: Identifiable {
    let id: TaskDefinition.ID
}

// MARK: - Reload Key

/// Identifica mudanças que exigem recarregar a lista de tarefas.
private struct ReloadKey: Hashable {
    let activation: Int
    let taskChanges: Int
}
