//
//  TaskSuggestion.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

import Foundation

public struct TaskSuggestion: Identifiable, Hashable, Sendable {

    public let id: String

    public let name: String

    public let details: String

    public let effort: TaskEffort

    public init(
        id: String,
        name: String,
        details: String,
        effort: TaskEffort
    ) {
        self.id = id
        self.name = name
        self.details = details
        self.effort = effort
    }
}
