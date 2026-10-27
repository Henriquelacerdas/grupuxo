//
//  TaskSuggestionCatalog.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

import Foundation

/// Nomes em português; a tradução vem do `Localizable.xcstrings` do app (ver `DomainError`).
public struct TaskSuggestionCatalog: Sendable {
    public init() {}


    public func suggestions(
        for category: RoomCategory
    ) -> [TaskSuggestion] {

        switch category {

        case .kitchen:
            return [
                TaskSuggestion(
                    id: "kitchen.cleanFloor",
                    name: String(localized: "Limpar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanSink",
                    name: String(localized: "Limpar a pia"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanStove",
                    name: String(localized: "Limpar o fogão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "kitchen.organizeFridge",
                    name: String(localized: "Organizar a geladeira"),
                    details: "",
                    effort: TaskEffort(points: 3)
                )
            ]

        case .bathroom:
            return [
                TaskSuggestion(
                    id: "bathroom.cleanToilet",
                    name: String(localized: "Limpar o vaso sanitário"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanSink",
                    name: String(localized: "Limpar a pia"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanMirror",
                    name: String(localized: "Limpar o espelho"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanShower",
                    name: String(localized: "Lavar o box"),
                    details: "",
                    effort: TaskEffort(points: 3)
                )
            ]

        case .bedroom:
            return [
                TaskSuggestion(
                    id: "bedroom.changeSheets",
                    name: String(localized: "Trocar roupa de cama"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.cleanFloor",
                    name: String(localized: "Limpar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.dust",
                    name: String(localized: "Tirar o pó"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bedroom.organizeWardrobe",
                    name: String(localized: "Organizar o guarda-roupa"),
                    details: "",
                    effort: TaskEffort(points: 3)
                )
            ]

        case .livingRoom:
            return [
                TaskSuggestion(
                    id: "livingRoom.vacuum",
                    name: String(localized: "Aspirar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "livingRoom.dust",
                    name: String(localized: "Tirar o pó"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "livingRoom.cleanFurniture",
                    name: String(localized: "Limpar os móveis"),
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .laundry:
            return [
                TaskSuggestion(
                    id: "laundry.washClothes",
                    name: String(localized: "Lavar roupas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.cleanFloor",
                    name: String(localized: "Limpar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.organizeProducts",
                    name: String(localized: "Organizar produtos de limpeza"),
                    details: "",
                    effort: TaskEffort(points: 1)
                )
            ]

        case .office:
            return [
                TaskSuggestion(
                    id: "office.dust",
                    name: String(localized: "Tirar o pó"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.organizeDesk",
                    name: String(localized: "Organizar a mesa"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.cleanFloor",
                    name: String(localized: "Limpar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .outdoor:
            return [
                TaskSuggestion(
                    id: "outdoor.sweep",
                    name: String(localized: "Varrer a área"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "outdoor.organize",
                    name: String(localized: "Organizar a área"),
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .other:
            return []
        }
    }
}
