import GrupuxoDomain
import SwiftUI

/// Configuração da casa: código de convite, cômodos, moradores, WhatsApp e sair da casa.
/// Cômodos e moradores aparecem só para consulta: criar cômodo fica em Casa, e entrar na casa é pelo código.
struct HouseView: View {
    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService

    @StateObject private var whatsApp: WhatsAppConnectionViewModel
    @State private var confirmLeave = false
    @State private var copied = false

    init(whatsAppViewModel: WhatsAppConnectionViewModel) {
        _whatsApp = StateObject(wrappedValue: whatsAppViewModel)
    }

    var body: some View {
        List {
            if let house = houses.house {
                inviteSection(house)
            }
            WhatsAppConnectionSection(viewModel: whatsApp)
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
                    if isLastMember {
                        houses.leaveNeedsHouseDeletionConfirmation = true
                    } else {
                        confirmLeave = true
                    }
                }
                .disabled(houses.isLoading)

                Button("Sair da conta", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task { await authService.signOut() }
                }
            } footer: {
                if isLastMember {
                    Text("Você é o único morador: se sair, a casa será excluída.")
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
        .confirmationDialog("Sair da casa?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Sair da casa", role: .destructive) { Task { await houses.leaveHouse() } }
        }
        .confirmationDialog(
            "Cômodos serão excluídos",
            isPresented: $houses.leaveNeedsConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sair e excluir os cômodos", role: .destructive) {
                Task { await houses.leaveHouse(confirmRoomDeletion: true) }
            }
        } message: {
            Text("Você é o último participante de algum cômodo. Se sair, o cômodo e as tarefas dele serão excluídos.")
        }
        .confirmationDialog(
            "Excluir a casa?",
            isPresented: $houses.leaveNeedsHouseDeletionConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sair e excluir a casa", role: .destructive) {
                Task { await houses.leaveHouse(confirmRoomDeletion: true, confirmHouseDeletion: true) }
            }
        } message: {
            Text("Você é o último morador. Se sair, a casa, os cômodos, as tarefas e o histórico serão excluídos, e o código de convite deixa de valer. Não dá para desfazer.")
        }
    }

    private var isLastMember: Bool { houses.members.count <= 1 }

    // MARK: - Seções

    private func inviteSection(_ house: House) -> some View {
        let code = house.accessCode
        return Section {
            HStack {
                Text(code)
                    .font(.title.monospaced().bold())
                    .kerning(4)
                    .textSelection(.enabled)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Copiar código")

                ShareLink(item: "Entre na casa \"\(house.name)\" no app usando o código: \(code)") {
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
            ForEach(houses.rooms) { room in
                Label(room.name, systemImage: room.icon)
            }
        } header: {
            Text("Cômodos (\(houses.rooms.count))")
        }
    }

    private var membersSection: some View {
        Section {
            ForEach(houses.members) { member in
                MemberRow(member: member, isMe: member.id == houses.me?.id)
            }
        } header: {
            Text("Moradores (\(houses.members.count))")
        }
    }
}

private struct MemberRow: View {
    let member: User
    let isMe: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(String(member.name.prefix(1)).uppercased())
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.accentColor))
            Text(isMe ? "\(member.name) (você)" : member.name)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }
}
