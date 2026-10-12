import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

@MainActor
struct RootModelTests {
    private let userID = UUID()
    private let houseID = UUID()
    private let roomID = UUID()

    private func snapshot(roomName: String, extraResident: UUID? = nil) -> HouseSnapshot {
        HouseSnapshot(
            houseID: houseID, houseName: "Casa", inviteCode: "ABC234",
            residents: [.init(id: userID, name: "Ana")]
                + (extraResident.map { [.init(id: $0, name: "Bia")] } ?? []),
            rooms: [.init(id: roomID, name: roomName)]
        )
    }

    private func apply(_ model: RootModel, _ snapshot: HouseSnapshot) async throws {
        try await model.apply(
            snapshot,
            user: User(id: userID, name: "Ana", email: nil),
            house: House(id: houseID, name: "Casa", accessCode: "ABC234", createdAt: .now)
        )
    }

    private func task() -> TaskDefinition {
        TaskDefinition(
            id: UUID(), roomID: roomID, name: "Limpar", details: "", effort: TaskEffort(points: 2),
            kind: .recurring, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 1)),
            assignmentPolicy: .calendarRotation
        )
    }

    @Test func houseActionsKeepTheSameStoreAndTasks() async throws {
        let model = RootModel()
        let container = model.container
        #expect(!model.isSynced)

        try await apply(model, snapshot(roomName: "Cozinha"))
        #expect(model.isSynced)

        let created = try await container.taskRepository.create(task(), requestedBy: userID, at: .now)

        // Cada ação na casa (renomear cômodo, entrar morador) re-sincroniza o mesmo modelo.
        try await apply(model, snapshot(roomName: "Cozinha nova"))
        try await apply(model, snapshot(roomName: "Cozinha nova", extraResident: UUID()))

        #expect(model.container === container)
        let state = await container.store.read { $0 }
        #expect(state.definitions.contains { $0.id == created.id })
        #expect(state.rooms.first { $0.id == roomID }?.name == "Cozinha nova")
        #expect(model.session.currentUser.id == userID)
    }

    @Test func eachModelOwnsItsOwnStore() async throws {
        let first = RootModel()
        let second = RootModel()
        try await apply(first, snapshot(roomName: "Cozinha"))

        #expect(first.container !== second.container)
        let secondState = await second.container.store.read { $0 }
        #expect(secondState.rooms.isEmpty)
    }
}

@MainActor
struct HouseSnapshotMakeTests {
    private let houseID = UUID()
    private let userID = UUID()
    private let roomID = UUID()

    private func records(
        houseID: String? = nil, userID: String? = nil, roomID: String? = nil
    ) -> (HouseRecord, [MemberRecord], [RoomRecord]) {
        let hid = houseID ?? self.houseID.uuidString
        return (
            HouseRecord(id: hid, name: "Casa", ownerId: "o", members: []),
            [MemberRecord(houseId: hid, userId: userID ?? self.userID.uuidString, name: "Ana", role: "MEMBER", members: [])],
            [RoomRecord(id: roomID ?? self.roomID.uuidString, houseId: hid, name: "Cozinha", members: [])]
        )
    }

    @Test func buildsSnapshotAndIgnoresCase() throws {
        let (house, members, rooms) = records()
        let upper = try HouseSnapshot.make(house: house, members: members, rooms: rooms, inviteCode: "ABC234")
        let (houseL, membersL, roomsL) = records(
            houseID: houseID.uuidString.lowercased(),
            userID: userID.uuidString.lowercased(),
            roomID: roomID.uuidString.lowercased()
        )
        let lower = try HouseSnapshot.make(house: houseL, members: membersL, rooms: roomsL, inviteCode: nil)
        #expect(upper.houseID == houseID && lower.houseID == houseID)
        #expect(upper.residents.first?.id == userID && lower.residents.first?.id == userID)
        #expect(upper.rooms.first?.id == roomID && lower.rooms.first?.id == roomID)
        #expect(lower.inviteCode == "")
    }

    @Test(arguments: ["house", "user", "room"])
    func invalidIDThrows(which: String) {
        let (house, members, rooms) = switch which {
        case "house": records(houseID: "casa-1")
        case "user": records(userID: "sub-que-nao-e-uuid")
        default: records(roomID: "quarto")
        }
        #expect(throws: SnapshotError.self) {
            try HouseSnapshot.make(house: house, members: members, rooms: rooms, inviteCode: nil)
        }
    }

    @Test func invalidIDFailsClosedAndRetryConverges() async throws {
        let model = RootModel()
        let (house, members, rooms) = records(roomID: "quarto")
        await model.sync(house: house, members: members, rooms: rooms, inviteCode: nil, me: members[0])

        guard case .failed = model.syncState else {
            Issue.record("id inválido deveria deixar .failed")
            return
        }
        let untouched = await model.container.store.read { $0 }
        #expect(untouched.rooms.isEmpty && untouched.houses.isEmpty && untouched.users.isEmpty)

        let (_, _, goodRooms) = records()
        await model.sync(house: house, members: members, rooms: goodRooms, inviteCode: "ABC234", me: members[0])
        #expect(model.syncState == .synced)
        let state = await model.container.store.read { $0 }
        #expect(state.rooms.map(\.id) == [roomID])
        #expect(model.session.currentUser.id == userID)
    }

    @Test func syncedStateSurvivesLaterFailure() async throws {
        let model = RootModel()
        let (house, members, rooms) = records()
        await model.sync(house: house, members: members, rooms: rooms, inviteCode: nil, me: members[0])
        #expect(model.isSynced)

        let (_, _, badRooms) = records(roomID: "x")
        await model.sync(house: house, members: members, rooms: badRooms, inviteCode: nil, me: members[0])
        guard case .failed = model.syncState else {
            Issue.record("falha deve ficar visível")
            return
        }
        let state = await model.container.store.read { $0 }
        #expect(state.rooms.map(\.id) == [roomID])
    }
}

@MainActor
struct RoomCreationRollbackTests {
    private struct Boom: LocalizedError { var errorDescription: String? { "Sem rede" } }

    private let userID = UUID()
    private let houseID = UUID()

    private func syncedModel() async throws -> RootModel {
        let model = RootModel()
        try await model.apply(
            HouseSnapshot(
                houseID: houseID, houseName: "Casa", inviteCode: "ABC234",
                residents: [.init(id: userID, name: "Ana")], rooms: []
            ),
            user: User(id: userID, name: "Ana", email: nil),
            house: House(id: houseID, name: "Casa", accessCode: "ABC234", createdAt: .now)
        )
        return model
    }

    @Test func failedRemoteSaveShowsErrorAndResyncRemovesOrphanRoom() async throws {
        let model = try await syncedModel()
        let editor = model.container.makeRoomEditorViewModel(
            session: model.session, onCreated: { _ in throw Boom() }
        )
        editor.updateDraft { $0.name = "Quarto" }
        await editor.save()

        guard case let .failure(draft, message) = editor.state else {
            Issue.record("esperava .failure, veio \(editor.state)")
            return
        }
        #expect(message == "Sem rede" && draft.name == "Quarto")
        let orphaned = await model.container.store.read { $0 }
        #expect(orphaned.rooms.count == 1)

        // Re-sync com a casa real, que não tem o cômodo.
        try await model.container.sync(
            HouseSnapshot(
                houseID: houseID, houseName: "Casa", inviteCode: "ABC234",
                residents: [.init(id: userID, name: "Ana")], rooms: []
            )
        )
        let state = await model.container.store.read { $0 }
        #expect(state.rooms.isEmpty)
        #expect(state.schedule.rooms.isEmpty && state.schedule.roomMemberships.isEmpty)
    }

    @Test func successfulRemoteSaveEndsSaved() async throws {
        let model = try await syncedModel()
        let editor = model.container.makeRoomEditorViewModel(session: model.session, onCreated: { _ in })
        editor.updateDraft { $0.name = "Quarto" }
        await editor.save()
        guard case .saved = editor.state else {
            Issue.record("esperava .saved, veio \(editor.state)")
            return
        }
    }
}
