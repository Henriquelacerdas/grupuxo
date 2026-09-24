//
//  TaskSuggestion.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

import Foundation

struct TaskSuggestion: Identifiable, Hashable, Sendable {

    let id: String

    let name: String

    let details: String

    let effort: TaskEffort
}
