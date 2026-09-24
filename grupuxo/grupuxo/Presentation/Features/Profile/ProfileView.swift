import SwiftUI
import Combine

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published private(set) var members: [User] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published var residentName = ""
    @Published var mutationError: String?
    @Published private(set) var isSaving = false
    private let addMember: AddHouseMemberUseCase
    private let removeMember: RemoveHouseMemberUseCase
    var canAdd: Bool { !isSaving && !residentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private let getMembers: GetHouseMembersUseCase
    private let houseID: House.ID
    let currentUserID: User.ID

    init(getMembers: GetHouseMembersUseCase, addMember: AddHouseMemberUseCase, removeMember: RemoveHouseMemberUseCase, houseID: House.ID, currentUserID: User.ID) {
        self.addMember = addMember
        self.removeMember = removeMember
        self.getMembers = getMembers
        self.houseID = houseID
        self.currentUserID = currentUserID
    }

    func add() async -> Bool {
        guard canAdd else { return false }
        isSaving = true
        mutationError = nil
        defer { isSaving = false }
        do {
            _ = try await addMember(name: residentName, houseID: houseID, requestedBy: currentUserID)
            residentName = ""
            await load()
            return true
        } catch {
            mutationError = error.localizedDescription
            return false
        }
    }

    func remove(_ user: User) async {
        guard !isSaving else { return }
        isSaving = true
        mutationError = nil
        defer { isSaving = false }
        do {
            try await removeMember(userID: user.id, houseID: houseID, requestedBy: currentUserID, confirmRoomDeletion: true)
            await load()
        } catch {
            mutationError = error.localizedDescription
        }
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            members = try await getMembers(houseID: houseID, userID: currentUserID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ProfileView: View {
    @StateObject private var viewModel: ProfileViewModel
    @State private var showingAdd = false
    @State private var memberToRemove: User?
    @FocusState private var nameFocused: Bool

    init(viewModel: ProfileViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        List {
            Section("Moradores da casa") {
                if viewModel.isLoading {
                    ProgressView("Carregando moradores…")
                } else if let message = viewModel.errorMessage {
                    Text(message)
                    Button("Tentar novamente") { Task { await viewModel.load() } }
                } else if viewModel.members.isEmpty {
                    Text("Nenhum morador cadastrado.")
                } else {
                    ForEach(viewModel.members) { user in
                        HStack {
                            ResidentAvatar(user: user)
                            VStack(alignment: .leading) {
                                Text(user.name)
                                if user.id == viewModel.currentUserID {
                                    Text("Você").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if user.id != viewModel.currentUserID {
                                Button(role: .destructive) { memberToRemove = user } label: {
                                    Image(systemName: "person.badge.minus")
                                        .frame(minWidth: 44, minHeight: 44)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Remover \(user.name) da casa")
                                .disabled(viewModel.isSaving)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .swipeActions(allowsFullSwipe: false) {
                            if user.id != viewModel.currentUserID {
                                Button("Remover", role: .destructive) { memberToRemove = user }
                                    .disabled(viewModel.isSaving)
                            }
                        }
                        .contextMenu {
                            if user.id != viewModel.currentUserID {
                                Button("Remover da casa", systemImage: "person.badge.minus", role: .destructive) {
                                    memberToRemove = user
                                }
                                .disabled(viewModel.isSaving)
                            }
                        }
                    }
                }
                Button {
                    viewModel.residentName = ""
                    viewModel.mutationError = nil
                    showingAdd = true
                } label: {
                    Label("Adicionar morador", systemImage: "person.badge.plus")
                }
                .disabled(viewModel.isSaving)
            }
            if viewModel.isSaving && !showingAdd {
                ProgressView("Atualizando moradores…")
            }
            if let message = viewModel.mutationError, !showingAdd {
                Section { Text(message).foregroundStyle(.red) }
            }
        }
        .sheet(isPresented: $showingAdd) {
            NavigationStack {
                Form {
                    Section("Novo morador") {
                        TextField("Nome", text: $viewModel.residentName)
                            .textContentType(.name)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .focused($nameFocused)
                            .disabled(viewModel.isSaving)
                            .onSubmit { addResident() }
                    }
                    if let message = viewModel.mutationError {
                        Section { Text(message).foregroundStyle(.red) }
                    }
                    if viewModel.isSaving { ProgressView("Adicionando morador…") }
                }
                .navigationTitle("Adicionar morador")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancelar") { showingAdd = false }
                            .disabled(viewModel.isSaving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Adicionar") { addResident() }
                            .disabled(!viewModel.canAdd)
                    }
                }
                .interactiveDismissDisabled(viewModel.isSaving)
                .task { nameFocused = true }
            }
        }
        .alert("Remover morador?", isPresented: Binding(
            get: { memberToRemove != nil },
            set: { if !$0 { memberToRemove = nil } }
        )) {
            if let user = memberToRemove {
                Button("Remover da casa", role: .destructive) {
                    Task { await viewModel.remove(user) }
                }
            }
            Button("Cancelar", role: .cancel) { memberToRemove = nil }
        } message: {
            if let user = memberToRemove {
                Text("Remover \(user.name) da casa? A participação nos cômodos e nas próximas escalas será encerrada. Cômodos privados em que essa pessoa for o último participante e suas tarefas serão excluídos.")
            }
        }
        .navigationTitle("Perfil")
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }

    private func addResident() {
        Task {
            if await viewModel.add() { showingAdd = false }
        }
    }
}
