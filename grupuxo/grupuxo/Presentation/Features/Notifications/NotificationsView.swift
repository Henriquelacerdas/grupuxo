//
//  NotificationsView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import Foundation
import SwiftUI
import GrupuxoDomain

/// Notificações: pedidos de troca recebidos ("Pedidos"), os que você fez ("Seus pedidos") e as novidades por dia.
struct NotificationsView: View {

    @StateObject
    private var viewModel: NotificationsViewModel

    /// Tocar num aviso que aponta para uma tarefa ou um cômodo abre o destino.
    private let onOpenTask: (TaskDefinition.ID) -> Void
    private let onOpenRoom: (Room.ID) -> Void

    init(
        viewModel: NotificationsViewModel,
        onOpenTask: @escaping (TaskDefinition.ID) -> Void = { _ in },
        onOpenRoom: @escaping (Room.ID) -> Void = { _ in }
    ) {
        _viewModel = StateObject(
            wrappedValue: viewModel
        )
        self.onOpenTask = onOpenTask
        self.onOpenRoom = onOpenRoom
    }

    var body: some View {

        Group {

            switch viewModel.state {

            case .idle, .loading:

                ProgressView(
                    "Carregando notificações…"
                )

            case .empty:

                ContentUnavailableView(
                    "Nada por aqui",
                    systemImage: "bell",
                    description: Text(
                        "Pedidos de troca e mudanças nas tarefas da casa aparecem aqui."
                    )
                )

            case let .content(notifications, pendingSwaps, outgoingSwaps):

                List {

                    if !pendingSwaps.isEmpty {
                        Section {
                            ForEach(pendingSwaps) { swap in
                                incomingRow(swap)
                            }
                        } header: {
                            sectionHeader(Text("Pedidos"))
                        }
                    }

                    if !outgoingSwaps.isEmpty {
                        Section {
                            ForEach(outgoingSwaps) { swap in
                                outgoingRow(swap)
                            }
                        } header: {
                            sectionHeader(Text("Seus pedidos"))
                        }
                    }

                    ForEach(viewModel.days(of: notifications)) { day in
                        Section {
                            ForEach(day.notifications) { notification in
                                notificationRow(notification)
                            }
                        } header: {
                            sectionHeader(Text(day.title))
                        }
                    }
                }

            case let .failure(message):

                ContentUnavailableView(
                    "Não foi possível carregar",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Notificações")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load()
        }
        .onChange(of: viewModel.actionError) { _, error in
            if error != nil { Haptics.error() }
        }
        .alert(
            "Não foi possível atualizar",
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.actionError = nil } }
            )
        ) {
            Button("OK") { viewModel.actionError = nil }
        } message: {
            Text(viewModel.actionError ?? "")
        }
    }

    private func sectionHeader(_ title: Text) -> some View {
        title
            .font(.title3.bold())
            .foregroundStyle(Color.primary)
            .textCase(nil)
    }

    // MARK: - Pedidos

    /// "Henrique L. quer trocar": o que você dá, o que recebe e Recusar/Aceitar.
    private func incomingRow(_ swap: IncomingSwapRequest) -> some View {

        let requester = swap.requesterName.map(ResidentNameFormatting.shortName)

        return VStack(alignment: .leading, spacing: DesignSystem.Spacing.medium) {

            HStack(alignment: .firstTextBaseline) {
                Text("\(Text(requester ?? String(localized: "Um morador")).bold()) quer trocar")
                Spacer(minLength: DesignSystem.Spacing.small)
                elapsed(swap.request.createdAt)
            }

            HStack(spacing: DesignSystem.Spacing.small) {
                swapTask(owner: String(localized: "Você"), name: swap.requestedTaskName)
                Image(systemName: "arrow.left.arrow.right")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                swapTask(owner: requester, name: swap.offeredTaskName)
            }

            HStack(spacing: DesignSystem.Spacing.small) {
                Button {
                    Task { await viewModel.reject(swap) }
                } label: {
                    Text("Recusar").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await viewModel.accept(swap) }
                } label: {
                    Text("Aceitar").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            .buttonBorderShape(.capsule)
            .disabled(viewModel.respondingSwapID != nil)
        }
        .padding(.vertical, DesignSystem.Spacing.small)
    }

    /// "Aguardando Vidal": o que você dá e o que recebe.
    private func outgoingRow(_ swap: OutgoingSwapRequest) -> some View {

        VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {

            HStack(alignment: .firstTextBaseline) {
                Text(
                    "Aguardando \(Text(swap.receiverName.map(ResidentNameFormatting.shortName) ?? String(localized: "resposta")).bold())"
                )
                Spacer(minLength: DesignSystem.Spacing.small)
                elapsed(swap.request.createdAt)
            }

            if let offered = swap.offeredTaskName {
                Text("Você dá \(Text(offered).bold())")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let requested = swap.requestedTaskName {
                Text("Você recebe \(Text(requested).bold())")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if viewModel.canCancelSwaps {
                Button(role: .destructive) {
                    Task { await viewModel.cancel(swap) }
                } label: {
                    Text("Cancelar pedido")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .disabled(viewModel.cancellingSwapID != nil)
                .padding(.top, DesignSystem.Spacing.extraSmall)
            }
        }
        .padding(.vertical, DesignSystem.Spacing.extraSmall)
    }

    private func swapTask(owner: String?, name: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let owner {
                Text(owner)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(name ?? String(localized: "Uma tarefa"))
                .font(.subheadline.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DesignSystem.Spacing.small)
        .background(
            Color(uiColor: .tertiarySystemFill),
            in: RoundedRectangle(cornerRadius: DesignSystem.Spacing.medium, style: .continuous)
        )
    }

    private func elapsed(_ date: Date) -> some View {
        Text(date, format: .relative(presentation: .named))
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    // MARK: - Novidades

    private func notificationRow(_ notification: AppNotification) -> some View {

        Button {
            Task { await viewModel.markAsRead(notification) }
            switch NotificationText.target(for: notification) {
            case let .task(id): onOpenTask(id)
            case let .room(id): onOpenRoom(id)
            case nil: break
            }
        } label: {
            HStack(alignment: .center, spacing: DesignSystem.Spacing.medium) {

                Image(systemName: iconName(for: notification))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: DesignSystem.minimumTouchTarget - 4, height: DesignSystem.minimumTouchTarget - 4)
                    .background(Circle().fill(iconColor(for: notification)))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: DesignSystem.Spacing.extraSmall) {
                    Text(message(for: notification))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)

                    Text(notification.createdAt, format: .dateTime.hour().minute())
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if notification.kind == .roomAccessRequested, viewModel.canAnswerRoomAccess {
                        accessButtons(for: notification)
                    }
                }

                Spacer(minLength: 0)

                if !notification.isRead {
                    Circle()
                        .fill(.tint)
                        .frame(width: 10, height: 10)
                        .accessibilityLabel("Não lida")
                }
            }
            .padding(.vertical, DesignSystem.Spacing.extraSmall)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Pedido de entrada em cômodo privado: qualquer participante recusa ou aceita.
    private func accessButtons(for notification: AppNotification) -> some View {

        HStack(spacing: DesignSystem.Spacing.small) {
            Button {
                Task { await viewModel.answerAccess(notification, approve: false) }
            } label: {
                Text("Recusar")
            }
            .buttonStyle(.bordered)

            Button {
                Task { await viewModel.answerAccess(notification, approve: true) }
            } label: {
                Text("Aceitar")
            }
            .buttonStyle(.borderedProminent)
        }
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .disabled(viewModel.answeringNotificationID != nil)
        .padding(.top, DesignSystem.Spacing.extraSmall)
    }

    private func message(for notification: AppNotification) -> String {
        NotificationText.message(for: notification, memberNames: viewModel.memberNames)
    }

    private func iconName(for notification: AppNotification) -> String {
        NotificationText.iconName(for: notification.kind)
    }

    private func iconColor(for notification: AppNotification) -> Color {
        switch NotificationText.tint(for: notification.kind) {
        case .accent: .accentColor
        case .orange: .orange
        case .green: .green
        case .gray: .gray
        case .red: .red
        case .blue: .blue
        }
    }
}
