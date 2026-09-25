//
//  TaskSwapState.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 24/09/26.
//

enum TaskSwapState: Equatable {
    case idle
    case loading
    case content(
        offeredTask: TaskItem,
        candidates: [TaskItem]
    )
    case sent
    case failure(String)
}
