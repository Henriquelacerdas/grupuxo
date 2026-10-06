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

    case content([AppNotification])

    case empty

    case failure(String)

}
