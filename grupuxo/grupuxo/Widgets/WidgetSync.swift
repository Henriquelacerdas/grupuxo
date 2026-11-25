import Foundation
import GrupuxoDomain

/// Sincroniza os dados carregados pelo app e pela Siri com o `WidgetTaskStore`.
enum WidgetSync {

    static func update(from snapshot: RemoteHouseSnapshot) {
        let participationsByRoomID = Dictionary(
            snapshot.participations.map { ($0.room.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let roomsByID = Dictionary(
            snapshot.home.rooms.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        func makeWidgetTask(_ item: TaskItem) -> WidgetTaskItem {
            let roomDTO = roomsByID[item.definition.roomID]
            let participation = participationsByRoomID[item.definition.roomID]
            let effectiveDue: Date? = item.occurrence.dueAt.map { $0.addingTimeInterval(-1) } ?? participation.map {
                Calendar.current.date(byAdding: .day, value: -1, to: $0.periodEnd) ?? $0.periodEnd
            }
            return WidgetTaskItem(
                occurrenceID: item.occurrence.id,
                taskDefinitionID: item.definition.id,
                roomID: item.definition.roomID,
                name: item.definition.name,
                roomName: roomDTO?.name,
                roomIcon: roomDTO?.icon ?? "house.fill",
                dueAt: effectiveDue,
                colorRawValue: roomDTO?.color.rawValue ?? "orange"
            )
        }

        let pendingTasks = snapshot.myTasks
            .filter { !$0.occurrence.isCompleted }
            .sortedByDeadline()
            .map(makeWidgetTask)

        let roomSummaries: [WidgetRoomSummary] = snapshot.home.rooms.compactMap { roomDTO in
            let participation = participationsByRoomID[roomDTO.id]
            if let participation, !participation.isMember {
                return nil
            }
            let roomDomain = roomDTO.domain
            let cycleTasks: [TaskItem]
            if let participation {
                cycleTasks = snapshot.roomTasks.filter {
                    $0.definition.isLinked(to: roomDomain)
                        && $0.occurrence.availableAt >= participation.periodStart
                        && $0.occurrence.availableAt < participation.periodEnd
                }
            } else {
                cycleTasks = snapshot.roomTasks.filter { $0.definition.roomID == roomDTO.id }
            }
            let myRoomPending = pendingTasks.filter { $0.roomID == roomDTO.id }
            let completedCount = cycleTasks.filter { $0.occurrence.isCompleted }.count
            let totalCount = max(cycleTasks.count, completedCount + myRoomPending.count)

            return WidgetRoomSummary(
                id: roomDTO.id,
                name: roomDTO.name,
                icon: roomDTO.icon,
                colorRawValue: roomDTO.color.rawValue,
                periodEnd: participation?.periodEnd,
                completedCount: completedCount,
                totalCount: totalCount,
                pendingTasks: myRoomPending
            )
        }

        WidgetTaskStore.shared.saveReady(
            houseName: snapshot.home.house.name,
            tasks: pendingTasks,
            rooms: roomSummaries
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
                    roomID: item.definition.roomID,
                    name: item.definition.name,
                    roomName: room?.name,
                    roomIcon: room?.icon ?? "house.fill",
                    dueAt: item.occurrence.dueAt,
                    colorRawValue: room?.color.rawValue ?? "orange"
                )
            }
        let roomSummaries = rooms.map { room in
            let roomPending = pending.filter { $0.roomID == room.id }
            let roomAll = items.filter { $0.definition.roomID == room.id }
            let completed = roomAll.filter { $0.occurrence.isCompleted }.count
            return WidgetRoomSummary(
                id: room.id,
                name: room.name,
                icon: room.icon,
                colorRawValue: room.color.rawValue,
                periodEnd: nil,
                completedCount: completed,
                totalCount: max(roomAll.count, roomPending.count),
                pendingTasks: roomPending
            )
        }
        WidgetTaskStore.shared.saveReady(houseName: houseName, tasks: pending, rooms: roomSummaries)
    }

    static func update(from overview: MyTasksOverview, houseName: String) {
        var roomByTaskID: [TaskOccurrence.ID: Room] = [:]
        var periodEndByRoomID: [Room.ID: Date] = [:]
        var allItems: [TaskItem] = []

        for group in overview.cycleGroups {
            periodEndByRoomID[group.room.id] = group.periodEnd
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
            let periodEnd = room.flatMap { periodEndByRoomID[$0.id] }
            let effectiveDue = item.occurrence.dueAt.map { $0.addingTimeInterval(-1) } ?? periodEnd.map {
                Calendar.current.date(byAdding: .day, value: -1, to: $0) ?? $0
            }
            return WidgetTaskItem(
                occurrenceID: item.occurrence.id,
                taskDefinitionID: item.definition.id,
                roomID: room?.id,
                name: item.definition.name,
                roomName: room?.name,
                roomIcon: room?.icon ?? "house.fill",
                dueAt: effectiveDue,
                colorRawValue: room?.color.rawValue ?? "orange"
            )
        }

        let roomSummaries = overview.cycleGroups.map { group in
            let pending = sorted.filter { $0.roomID == group.room.id }
            return WidgetRoomSummary(
                id: group.room.id,
                name: group.room.name,
                icon: group.room.icon,
                colorRawValue: group.room.color.rawValue,
                periodEnd: group.periodEnd,
                completedCount: group.progress.completed,
                totalCount: group.progress.total,
                pendingTasks: pending
            )
        }

        WidgetTaskStore.shared.saveReady(houseName: houseName, tasks: sorted, rooms: roomSummaries)
    }
}
