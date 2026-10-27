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
        pendingSwaps: [IncomingSwapRequest]
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
