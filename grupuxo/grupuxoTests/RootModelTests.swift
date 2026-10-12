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
