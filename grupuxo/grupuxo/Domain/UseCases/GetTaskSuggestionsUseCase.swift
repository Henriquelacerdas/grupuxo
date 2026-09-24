//
//  GetTaskSuggestionsUseCase.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

struct GetTaskSuggestionsUseCase: Sendable {

    let catalog: TaskSuggestionCatalog

    func callAsFunction(
        category: RoomCategory
    ) -> [TaskSuggestion] {

        catalog.suggestions(
            for: category
        )
    }
}
