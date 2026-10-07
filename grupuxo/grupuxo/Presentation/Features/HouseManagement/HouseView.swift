import SwiftUI

/// Configuração da casa: código de convite, cômodos, moradores e sair da casa.
struct HouseView: View {
    @EnvironmentObject private var houses: HouseService
    @EnvironmentObject private var authService: AuthService

    @State private var newRoomName = ""
    @State private var newResidentName = ""
    @State private var roomToRename: RoomRecord?
    @State private var renameText = ""
    @State private var memberToRemove: MemberRecord?
    @State private var confirmLeave = false
    @State private var copied = false
    @FocusState private var focus: Field?

    private enum Field { case room, resident }

    var body: some View {
        List {
            if let house = houses.house {
                inviteSection(house)
            }
            roomsSection
            membersSection

            if let message = houses.errorMessage {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button("Sair da casa", systemImage: "door.left.hand.open", role: .destructive) {
                    confirmLeave = true
                }
                .disabled(houses.isLoading)
                
                Button("Sair da conta", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task { await authService.signOut() }
                }
            } footer: {
                if houses.members.filter({ $0.userId != nil }).count <= 1 {
                    Text("Você é o único morador com conta: sair apaga a casa, os cômodos e os moradores.")
                }
            }
        }
        .navigationTitle(houses.house?.name ?? "Minha casa")
        .toolbar {
            if houses.isLoading {
                ToolbarItem(placement: .topBarTrailing) { ProgressView() }
            }
        }
        .refreshable { await houses.refresh() }
        .alert("Renomear cômodo", isPresented: isPresented($roomToRename)) {
            TextField("Nome", text: $renameText)
            Button("Salvar") {
                if let room = roomToRename { Task { await houses.renameRoom(room, to: renameText) } }
            }
            Button("Cancelar", role: .cancel) {}
        }
        .alert("Remover morador?", isPresented: isPresented($memberToRemove), presenting: memberToRemove) { member in
            Button("Remover", role: .destructive) { Task { await houses.removeMember(member) } }
            Button("Cancelar", role: .cancel) {}
        } message: { member in
            Text("\(member.name) deixará de fazer parte da casa.")
        }
        .confirmationDialog("Sair da casa?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Sair da casa", role: .destructive) { Task { await houses.leaveHouse() } }
        }
    }

    // MARK: - Seções

    private func inviteSection(_ house: HouseRecord) -> some View {
        Section {
            HStack {
                Text(house.inviteCode)
                    .font(.title.monospaced().bold())
                    .kerning(4)
                    .textSelection(.enabled)
                Spacer()
                Button {
                    UIPasteboard.general.string = house.inviteCode
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Copiar código")

                ShareLink(item: "Entre na casa \"\(house.name)\" no app usando o código: \(house.inviteCode)") {
                    Image(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Compartilhar código")
            }
        } header: {
            Text("Código de convite")
        } footer: {
            Text("Quem tiver o código pode entrar na casa pelo app.")
        }
    }

    private var roomsSection: some View {
        Section {
            if houses.rooms.isEmpty {
                Text("Nenhum cômodo ainda.").foregroundStyle(.secondary)
            }
            ForEach(houses.rooms, id: \.id) { room in
                Label(room.name, systemImage: "square.split.bottomrightquarter")
                    .swipeActions {
                        Button("Excluir", role: .destructive) { Task { await houses.deleteRoom(room) } }
                        Button("Renomear") {
                            renameText = room.name
                            roomToRename = room
                        }
                        .tint(.orange)
                    }
                    .contextMenu {
                        Button("Renomear", systemImage: "pencil") {
                            renameText = room.name
                            roomToRename = room
                        }
                        Button("Excluir", systemImage: "trash", role: .destructive) {
                            Task { await houses.deleteRoom(room) }
                        }
                    }
            }
            HStack {
                TextField("Novo cômodo (ex.: Cozinha)", text: $newRoomName)
                    .textInputAutocapitalization(.sentences)
                    .focused($focus, equals: .room)
                    .submitLabel(.done)
                    .onSubmit(addRoom)
                Button("Adicionar", systemImage: "plus.circle.fill", action: addRoom)
                    .labelStyle(.iconOnly)
                    .font(.title3)
                    .buttonStyle(.borderless)
                    .disabled(newRoomName.isBlank || houses.isLoading)
            }
        } header: {
            Text("Cômodos (\(houses.rooms.count))")
        }
    }

    private var membersSection: some View {
        Section {
            ForEach(houses.members, id: \.id) { member in
                MemberRow(member: member, isMe: member.id == houses.myMember?.id)
                    .swipeActions {
                        if canRemove(member) {
                            Button("Remover", role: .destructive) { memberToRemove = member }
                        }
                    }
                    .contextMenu {
                        if houses.isAdmin, member.userId != nil, member.id != houses.myMember?.id {
                            let isAdmin = member.role == HouseService.Role.admin
                            Button(isAdmin ? "Tornar morador" : "Tornar administrador",
                                   systemImage: isAdmin ? "person" : "star") {
                                Task { await houses.setRole(member, admin: !isAdmin) }
                            }
                        }
                        if canRemove(member) {
                            Button("Remover", systemImage: "person.badge.minus", role: .destructive) {
                                memberToRemove = member
                            }
                        }
                    }
            }
            if houses.isAdmin {
                HStack {
                    TextField("Morador sem conta (nome)", text: $newResidentName)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        .focused($focus, equals: .resident)
                        .submitLabel(.done)
                        .onSubmit(addResident)
                    Button("Adicionar", systemImage: "person.crop.circle.badge.plus", action: addResident)
                        .labelStyle(.iconOnly)
                        .font(.title3)
                        .buttonStyle(.borderless)
                        .disabled(newResidentName.isBlank || houses.isLoading)
                }
            }
        } header: {
            Text("Moradores (\(houses.members.count))")
        } footer: {
            Text(houses.isAdmin
                 ? "Moradores com conta entram pelo código. Use o campo acima para quem não usa o app."
                 : "Só administradores podem adicionar ou remover moradores.")
        }
    }

    // MARK: - Ações

    private func canRemove(_ member: MemberRecord) -> Bool {
        houses.isAdmin && member.id != houses.myMember?.id
    }

    private func addRoom() {
        let name = newRoomName
        guard !name.isBlank else { return }
        newRoomName = ""
        Task { await houses.addRoom(name: name) }
    }

    private func addResident() {
        let name = newResidentName
        guard !name.isBlank else { return }
        newResidentName = ""
        Task { await houses.addResident(name: name) }
    }

    private func isPresented<T>(_ binding: Binding<T?>) -> Binding<Bool> {
        Binding(get: { binding.wrappedValue != nil }, set: { if !$0 { binding.wrappedValue = nil } })
    }
}

private struct MemberRow: View {
    let member: MemberRecord
    let isMe: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(String(member.name.prefix(1)).uppercased())
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Circle().fill(member.userId == nil ? Color.gray : Color.accentColor))
            VStack(alignment: .leading, spacing: 2) {
                Text(isMe ? "\(member.name) (você)" : member.name)
                Text(member.userId == nil ? "Sem conta" : "Com conta")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if member.role == HouseService.Role.admin {
                Text("Admin")
                    .font(.caption.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(.tint.opacity(0.15)))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private extension String {
    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
