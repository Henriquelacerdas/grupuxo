//
//  TaskSuggestionCatalog.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

import Foundation

struct TaskSuggestionCatalog: Sendable {

    func suggestions(
        for category: RoomCategory
    ) -> [TaskSuggestion] {

        switch category {

        case .kitchen:
            return [
                TaskSuggestion(
                    id: "kitchen.cleanFloor",
                    name: "Limpar o chão",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanSink",
                    name: "Limpar a pia",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanStove",
                    name: "Limpar o fogão",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "kitchen.organizeFridge",
                    name: "Organizar a geladeira",
                    details: "",
                    effort: TaskEffort(points: 3)
                )
            ]

        case .bathroom:
            return [
                TaskSuggestion(
                    id: "bathroom.cleanToilet",
                    name: "Limpar o vaso sanitário",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanSink",
                    name: "Limpar a pia",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanMirror",
                    name: "Limpar o espelho",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanShower",
                    name: "Lavar o box",
                    details: "",
                    effort: TaskEffort(points: 3)
                )
            ]

        case .bedroom:
            return [
                TaskSuggestion(
                    id: "bedroom.changeSheets",
                    name: "Trocar roupa de cama",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.cleanFloor",
                    name: "Limpar o chão",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.dust",
                    name: "Tirar o pó",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bedroom.organizeWardrobe",
                    name: "Organizar o guarda-roupa",
                    details: "",
                    effort: TaskEffort(points: 3)
                )
            ]

        case .livingRoom:
            return [
                TaskSuggestion(
                    id: "livingRoom.vacuum",
                    name: "Aspirar o chão",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "livingRoom.dust",
                    name: "Tirar o pó",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "livingRoom.cleanFurniture",
                    name: "Limpar os móveis",
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .laundry:
            return [
                TaskSuggestion(
                    id: "laundry.washClothes",
                    name: "Lavar roupas",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.cleanFloor",
                    name: "Limpar o chão",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.organizeProducts",
                    name: "Organizar produtos de limpeza",
                    details: "",
                    effort: TaskEffort(points: 1)
                )
            ]

        case .office:
            return [
                TaskSuggestion(
                    id: "office.dust",
                    name: "Tirar o pó",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.organizeDesk",
                    name: "Organizar a mesa",
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.cleanFloor",
                    name: "Limpar o chão",
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .outdoor:
            return [
                TaskSuggestion(
                    id: "outdoor.sweep",
                    name: "Varrer a área",
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "outdoor.organize",
                    name: "Organizar a área",
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .other:
            return []
        }
    }
}
