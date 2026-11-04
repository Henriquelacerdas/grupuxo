import GrupuxoDomain
import SwiftUI

/// Casa: nome, código de convite, moradores e sair da casa. Nome e moradores são só leitura; entrar na casa
/// é pelo código e criar cômodo fica na aba Casa.
struct HouseSettingsView: View {

    @EnvironmentObject private var houses: RemoteHouseSession

    @State private var confirmLeave = false

    var body: some View {

        List {

            if let house = houses.house {
                nameSection(house)
                inviteSection(house)
            }

            membersSection

            if let message = houses.errorMessage {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }

            leaveSection
        }
        .navigationTitle(houses.house?.name ?? String(localized: "Minha casa"))
        .navigationBarTitleDisplayMode(.inline)
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

    private func nameSection(_ house: House) -> some View {

        Section {
            Text(house.name)
        } header: {
            Text("Nome da casa").formSectionHeader()
        }
    }

    private func inviteSection(_ house: House) -> some View {

        Section {

            HStack(spacing: DesignSystem.Spacing.medium) {

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                    Text(house.accessCode)
                        .font(.title2.monospaced().bold())
                        .tracking(DesignSystem.inviteCodeTracking)
                        .textSelection(.enabled)
                    Text("Código da casa")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: DesignSystem.Spacing.small)

                CopyCodeButton(code: house.accessCode)

                ShareLink(item: String(localized: "Entre na casa \"\(house.name)\" no app usando o código: \(house.accessCode)")) {
                    Image(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Compartilhar código")
            }
        } header: {
            Text("Convite").formSectionHeader()
        } footer: {
            Text("Quem tiver o código pode entrar na casa pelo app.")
        }
    }

    private var membersSection: some View {

        Section {
            ForEach(houses.members) { member in
                MemberRow(member: member, isMe: member.id == houses.me?.id)
            }
        } header: {
            Text("Moradores").formSectionHeader()
        }
    }

    private var leaveSection: some View {

        Section {
            Button("Sair da casa", role: .destructive) {
                if isLastMember {
                    houses.leaveNeedsHouseDeletionConfirmation = true
                } else {
                    confirmLeave = true
                }
            }
            .frame(maxWidth: .infinity)
            .disabled(houses.isLoading)
            .listRowBackground(
                Color.red.opacity(DesignSystem.destructiveFillOpacity)
            )
        } footer: {
            if isLastMember {
                Text("Você é o único morador: se sair, a casa será excluída.")
            } else {
                Text("Ao sair, você deixa todos os cômodos da casa.")
            }
        }
    }
}

private struct MemberRow: View {

    let member: User
    let isMe: Bool

    var body: some View {

        HStack(spacing: DesignSystem.Spacing.medium) {

            ResidentAvatar(user: member)

            if isMe {
                Text("Você")
            } else {
                Text(member.name)
            }

            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
