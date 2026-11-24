//
//  TaskSuggestionCatalog.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 22/09/26.
//

import Foundation

/// Nomes em português; a tradução vem do `Localizable.xcstrings` do app (ver `DomainError`).
/// Os primeiros itens de cada categoria são os que `StarterRooms` usa; os ids são estáveis (o servidor guarda
/// `sourceSuggestionID`) e o mesmo catálogo existe em `backend/src/domain/services/task-suggestion-catalog.ts`.
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
                ),

                TaskSuggestion(
                    id: "kitchen.washDishes",
                    name: String(localized: "Lavar a louça"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.takeOutTrash",
                    name: String(localized: "Tirar o lixo"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.wipeCounters",
                    name: String(localized: "Limpar a bancada"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanMicrowave",
                    name: String(localized: "Limpar o micro-ondas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanOven",
                    name: String(localized: "Limpar o forno"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "kitchen.organizePantry",
                    name: String(localized: "Organizar a despensa"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "kitchen.sweepFloor",
                    name: String(localized: "Varrer a cozinha"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "kitchen.cleanHood",
                    name: String(localized: "Limpar a coifa"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "kitchen.replaceSponge",
                    name: String(localized: "Trocar a esponja"),
                    details: "",
                    effort: TaskEffort(points: 1)
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
                ),

                TaskSuggestion(
                    id: "bathroom.mopFloor",
                    name: String(localized: "Passar pano no chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bathroom.takeOutTrash",
                    name: String(localized: "Tirar o lixo"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.replaceToiletPaper",
                    name: String(localized: "Repor papel higiênico"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.washTowels",
                    name: String(localized: "Lavar as toalhas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bathroom.cleanDrain",
                    name: String(localized: "Limpar o ralo"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bathroom.organizeCabinet",
                    name: String(localized: "Organizar o armário"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bathroom.washBathMat",
                    name: String(localized: "Lavar o tapete do banheiro"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bathroom.descaleTaps",
                    name: String(localized: "Tirar o calcário das torneiras"),
                    details: "",
                    effort: TaskEffort(points: 2)
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
                ),

                TaskSuggestion(
                    id: "bedroom.makeBed",
                    name: String(localized: "Arrumar a cama"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bedroom.vacuum",
                    name: String(localized: "Aspirar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.airRoom",
                    name: String(localized: "Arejar o quarto"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bedroom.cleanWindows",
                    name: String(localized: "Limpar as janelas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.washBlankets",
                    name: String(localized: "Lavar os cobertores"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "bedroom.organizeDesk",
                    name: String(localized: "Organizar a escrivaninha"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "bedroom.flipMattress",
                    name: String(localized: "Virar o colchão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "bedroom.takeOutTrash",
                    name: String(localized: "Tirar o lixo"),
                    details: "",
                    effort: TaskEffort(points: 1)
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
                ),

                TaskSuggestion(
                    id: "livingRoom.organizeSofa",
                    name: String(localized: "Arrumar as almofadas e mantas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "livingRoom.cleanWindows",
                    name: String(localized: "Limpar as janelas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "livingRoom.mopFloor",
                    name: String(localized: "Passar pano no chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "livingRoom.cleanTV",
                    name: String(localized: "Limpar a TV e o painel"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "livingRoom.waterPlants",
                    name: String(localized: "Regar as plantas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "livingRoom.washRug",
                    name: String(localized: "Lavar o tapete"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "livingRoom.organizeShelves",
                    name: String(localized: "Organizar as estantes"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "livingRoom.takeOutTrash",
                    name: String(localized: "Tirar o lixo"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "livingRoom.cleanSofa",
                    name: String(localized: "Aspirar o sofá"),
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
                ),

                TaskSuggestion(
                    id: "laundry.hangClothes",
                    name: String(localized: "Estender as roupas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "laundry.foldClothes",
                    name: String(localized: "Dobrar as roupas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.ironClothes",
                    name: String(localized: "Passar roupa"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "laundry.cleanWasher",
                    name: String(localized: "Limpar a máquina de lavar"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.cleanLintFilter",
                    name: String(localized: "Limpar o filtro da secadora"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "laundry.cleanDrain",
                    name: String(localized: "Limpar o ralo"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "laundry.restockDetergent",
                    name: String(localized: "Repor sabão e amaciante"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "laundry.cleanTank",
                    name: String(localized: "Lavar o tanque"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "laundry.sortClothes",
                    name: String(localized: "Separar as roupas por cor"),
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
                ),

                TaskSuggestion(
                    id: "office.cleanScreen",
                    name: String(localized: "Limpar a tela e o teclado"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.organizeCables",
                    name: String(localized: "Organizar os cabos"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "office.organizeDocuments",
                    name: String(localized: "Organizar documentos"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "office.emptyBin",
                    name: String(localized: "Esvaziar a lixeira"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.vacuum",
                    name: String(localized: "Aspirar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "office.cleanWindows",
                    name: String(localized: "Limpar as janelas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "office.organizeShelves",
                    name: String(localized: "Organizar as estantes"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "office.waterPlants",
                    name: String(localized: "Regar as plantas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "office.wipeChair",
                    name: String(localized: "Limpar a cadeira"),
                    details: "",
                    effort: TaskEffort(points: 1)
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
                ),

                TaskSuggestion(
                    id: "outdoor.waterPlants",
                    name: String(localized: "Regar as plantas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "outdoor.washFloor",
                    name: String(localized: "Lavar o chão com mangueira"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "outdoor.takeOutTrash",
                    name: String(localized: "Levar o lixo para fora"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "outdoor.pruneGarden",
                    name: String(localized: "Podar as plantas"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "outdoor.cleanGrill",
                    name: String(localized: "Limpar a churrasqueira"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "outdoor.cleanFurniture",
                    name: String(localized: "Limpar os móveis externos"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "outdoor.cleanGutters",
                    name: String(localized: "Limpar as calhas"),
                    details: "",
                    effort: TaskEffort(points: 3)
                ),

                TaskSuggestion(
                    id: "outdoor.feedPets",
                    name: String(localized: "Limpar o espaço dos pets"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "outdoor.cleanGate",
                    name: String(localized: "Limpar o portão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "outdoor.collectLeaves",
                    name: String(localized: "Recolher as folhas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]

        case .other:
            return [
                TaskSuggestion(
                    id: "other.takeOutTrash",
                    name: String(localized: "Tirar o lixo"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.sweep",
                    name: String(localized: "Varrer o chão"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.mop",
                    name: String(localized: "Passar pano no chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "other.dust",
                    name: String(localized: "Tirar o pó"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.organize",
                    name: String(localized: "Organizar o espaço"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "other.vacuum",
                    name: String(localized: "Aspirar o chão"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "other.cleanWindows",
                    name: String(localized: "Limpar as janelas"),
                    details: "",
                    effort: TaskEffort(points: 2)
                ),

                TaskSuggestion(
                    id: "other.waterPlants",
                    name: String(localized: "Regar as plantas"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.changeBulb",
                    name: String(localized: "Trocar lâmpada queimada"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.airRoom",
                    name: String(localized: "Arejar o ambiente"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.cleanSurfaces",
                    name: String(localized: "Limpar as superfícies"),
                    details: "",
                    effort: TaskEffort(points: 1)
                ),

                TaskSuggestion(
                    id: "other.organizeShelves",
                    name: String(localized: "Organizar as prateleiras"),
                    details: "",
                    effort: TaskEffort(points: 2)
                )
            ]
        }
    }
}
