import Foundation
import GrupuxoDomain

/// Sincroniza os dados carregados pelo app e pela Siri com o `WidgetTaskStore` no App Group.
enum WidgetSync {

    static func update(from snapshot: RemoteHouseSnapshot) {
        update(
            houseName: snapshot.home.house.name,
            rooms: snapshot.home.rooms,
            items: snapshot.myTasks
        )
    }

    static func update(houseName: String, rooms: [RoomDTO], items: [TaskItem]) {
        let roomsByID = Dictionary(
            rooms.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let pending = items
            .filter { !$0.occurrence.isCompleted }
            .sortedByDeadline()
            .map { item in
                let room = roomsByID[item.definition.roomID]
                return WidgetTaskItem(
                    occurrenceID: item.occurrence.id,
                    taskDefinitionID: item.definition.id,
                    name: item.definition.name,
                    roomName: room?.name,
                    dueAt: item.occurrence.dueAt,
                    colorRawValue: room?.color.rawValue ?? "blue"
                )
            }
        WidgetTaskStore.shared.saveReady(houseName: houseName, tasks: pending)
    }

    static func update(from overview: MyTasksOverview, houseName: String) {
        var roomByTaskID: [TaskOccurrence.ID: Room] = [:]
        var allItems: [TaskItem] = []

        for group in overview.cycleGroups {
            for item in group.tasks where !item.occurrence.isCompleted {
                roomByTaskID[item.id] = group.room
                allItems.append(item)
            }
        }
        for extra in overview.extraTasks where !extra.item.occurrence.isCompleted {
            roomByTaskID[extra.item.id] = extra.room
            allItems.append(extra.item)
        }
        for sporadic in overview.sporadicTasks where !sporadic.item.occurrence.isCompleted {
            roomByTaskID[sporadic.item.id] = sporadic.room
            allItems.append(sporadic.item)
        }

        let sorted = allItems.sortedByDeadline().map { item in
            let room = roomByTaskID[item.id]
            return WidgetTaskItem(
                occurrenceID: item.occurrence.id,
                taskDefinitionID: item.definition.id,
                name: item.definition.name,
                roomName: room?.name,
                dueAt: item.occurrence.dueAt,
                colorRawValue: room?.color.rawValue ?? "blue"
            )
        }
        WidgetTaskStore.shared.saveReady(houseName: houseName, tasks: sorted)
    }
}

