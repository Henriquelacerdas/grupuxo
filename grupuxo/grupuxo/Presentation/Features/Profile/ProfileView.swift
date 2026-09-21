import SwiftUI
import Combine

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published private(set) var members: [User] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    private let getMembers: GetHouseMembersUseCase
    private let houseID: House.ID
    let currentUserID: User.ID

    init(getMembers: GetHouseMembersUseCase, houseID: House.ID, currentUserID: User.ID) {
        self.getMembers = getMembers
        self.houseID = houseID
        self.currentUserID = currentUserID
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
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .navigationTitle("Perfil")
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }
}
