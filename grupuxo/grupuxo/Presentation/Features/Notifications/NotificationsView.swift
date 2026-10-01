//
//  NotificationsView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import SwiftUI

struct NotificationsView: View {

    @StateObject
    private var viewModel: NotificationsViewModel

    init(
        viewModel: NotificationsViewModel
    ) {

        _viewModel = StateObject(
            wrappedValue: viewModel
        )

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
                    "Nenhuma notificação",
                    systemImage: "bell",
                    description: Text(
                        "As novidades da casa aparecerão aqui."
                    )
                )

            case let .content(notifications):

                List {

                    ForEach(notifications) {
                        notification in

                        Button {

                            Task {

                                await viewModel.markAsRead(
                                    notification
                                )

                            }

                        } label: {

                            HStack(
                                alignment: .top,
                                spacing:
                                    DesignSystem.Spacing.small
                            ) {

                                Image(
                                    systemName:
                                        iconName(
                                            for:
                                                notification
                                        )
                                )
                                .font(.title3)
                                .frame(
                                    width: 32,
                                    height: 32
                                )

                                VStack(
                                    alignment: .leading,
                                    spacing:
                                        DesignSystem
                                        .Spacing
                                        .extraSmall
                                ) {

                                    Text(
                                        message(
                                            for:
                                                notification
                                        )
                                    )
                                    .foregroundStyle(
                                        .primary
                                    )
                                    .multilineTextAlignment(
                                        .leading
                                    )

                                    Text(
                                        notification
                                            .createdAt
                                            .formatted(
                                                date:
                                                    .abbreviated,
                                                time:
                                                    .shortened
                                            )
                                    )
                                    .font(.caption)
                                    .foregroundStyle(
                                        .secondary
                                    )

                                }

                                Spacer()

                                if !notification.isRead {

                                    Circle()
                                        .fill(.tint)
                                        .frame(
                                            width: 8,
                                            height: 8
                                        )

                                }

                            }
                            .padding(
                                .vertical,
                                DesignSystem
                                    .Spacing
                                    .extraSmall
                            )

                        }
                        .buttonStyle(.plain)

                    }

                }

            case let .failure(message):

                ContentUnavailableView(
                    "Não foi possível carregar",
                    systemImage:
                        "exclamationmark.triangle",
                    description: Text(
                        message
                    )
                )

            }

        }
        .navigationTitle(
            "Notificações"
        )
        .task {

            await viewModel.load()

        }
        .refreshable {

            await viewModel.load()

        }
        .alert(
            "Não foi possível atualizar",
            isPresented: Binding(
                get: {
                    viewModel.actionError != nil
                },
                set: {
                    if !$0 {
                        viewModel.actionError = nil
                    }
                }
            )
        ) {

            Button("OK") {

                viewModel.actionError = nil

            }

        } message: {

            Text(
                viewModel.actionError ?? ""
            )

        }

    }

    private func message(
        for notification: AppNotification
    ) -> String {

        if let message =
            notification.message {

            return message

        }

        switch notification.kind {

        case .taskEdited:

            return "Uma tarefa foi editada."

        case .taskSwapRequested:

            return "Você recebeu uma solicitação de troca de tarefa."

        case .taskSwapAccepted:

            return "Sua solicitação de troca de tarefa foi aceita."

        case .taskSwapRejected:

            return "Sua solicitação de troca de tarefa foi recusada."

        }

    }

    private func iconName(
        for notification: AppNotification
    ) -> String {

        switch notification.kind {

        case .taskEdited:

            return "pencil"

        case .taskSwapRequested:

            return "arrow.left.arrow.right"

        case .taskSwapAccepted:

            return "checkmark.circle"

        case .taskSwapRejected:

            return "xmark.circle"

        }

    }

}
