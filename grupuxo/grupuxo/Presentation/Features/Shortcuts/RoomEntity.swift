//
//  RoomEntity.swift
//  grupuxo
//

import AppIntents
import GrupuxoDomain

/// Cômodo como opção de escolha nos atalhos.
struct RoomEntity: AppEntity {

    static let typeDisplayRepresentation =
        TypeDisplayRepresentation(name: "Cômodo")

    static let defaultQuery = RoomEntityQuery()

    let id: UUID
    let name: String
    let icon: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            image: .init(systemName: icon)
        )
    }

    init(_ room: Room) {
        id = room.id
        name = room.name
        icon = room.icon
    }
}

struct RoomEntityQuery: EntityQuery {

    func entities(for identifiers: [UUID]) async throws -> [RoomEntity] {
        try await rooms().filter { identifiers.contains($0.id) }
    }

    /// Lista exibida para escolher: a Casa toda primeiro, depois os demais cômodos.
    func suggestedEntities() async throws -> [RoomEntity] {
        try await rooms()
    }

    private func rooms() async throws -> [RoomEntity] {
        let list = try await ShortcutBackend.loadRooms()
        return (list.filter(\.representsWholeHouse)
                + list.filter { !$0.representsWholeHouse })
            .map(RoomEntity.init)
    }
}
