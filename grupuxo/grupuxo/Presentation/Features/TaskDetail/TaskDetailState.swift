//
//  TaskDetailState.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 01/10/26.
//

enum TaskDetailState: Equatable {

    case idle

    case loading

    case content(TaskDefinition)

    case failure(String)

}
