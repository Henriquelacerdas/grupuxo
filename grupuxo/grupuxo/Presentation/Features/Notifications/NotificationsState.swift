//
//  NotificationsState.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

import GrupuxoDomain

enum NotificationsState: Equatable {

    case idle

    case loading

    case content(
        notifications: [AppNotification],
        pendingSwaps: [IncomingSwapRequest],
        outgoingSwaps: [OutgoingSwapRequest] = []
    )

    case empty

    case failure(String)

}

/// Pedido de troca pendente recebido, com os nomes já resolvidos para a tela.
struct IncomingSwapRequest: Identifiable, Equatable {

    let request: TaskSwapRequest

    /// Quem pediu; `nil` se o morador não foi encontrado na casa.
    let requesterName: String?

    /// Tarefa de quem pediu, que passa para mim se eu aceitar.
    let offeredTaskName: String?

    /// Minha tarefa, que passa para quem pediu se eu aceitar.
    let requestedTaskName: String?

    var id: TaskSwapRequest.ID {
        request.id
    }

}

/// Pedido de troca que eu fiz e ainda espera resposta.
struct OutgoingSwapRequest: Identifiable, Equatable {

    let request: TaskSwapRequest

    /// Quem precisa aceitar; `nil` se o morador não foi encontrado na casa.
    let receiverName: String?

    /// Minha tarefa, que passa para a outra pessoa se ela aceitar.
    let offeredTaskName: String?

    /// Tarefa da outra pessoa, que passa para mim se ela aceitar.
    let requestedTaskName: String?

    var id: TaskSwapRequest.ID {
        request.id
    }
}

/// Notificações de um mesmo dia, com o título "Hoje", "Ontem" ou a data.
struct NotificationDay: Identifiable, Equatable {
    let title: String
    let notifications: [AppNotification]

    var id: String { title }
}
