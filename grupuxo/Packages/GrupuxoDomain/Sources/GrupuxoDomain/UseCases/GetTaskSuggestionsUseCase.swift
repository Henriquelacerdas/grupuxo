//
//  GetTaskSuggestionsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

public struct GetTaskSuggestionsUseCase: Sendable {

    public let catalog: TaskSuggestionCatalog

    public init(catalog: TaskSuggestionCatalog) {
        self.catalog = catalog
    }

    public func callAsFunction(
        category: RoomCategory
    ) -> [TaskSuggestion] {

        catalog.suggestions(
            for: category
        )
    }
}
