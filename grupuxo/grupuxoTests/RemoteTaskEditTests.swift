import Foundation
import Testing
import GrupuxoDomain
@testable import grupuxo

/// Editar e excluir tarefa única pela `api`: `PATCH` e `DELETE /v1/rooms/{roomID}/tasks/{taskID}`.
struct RemoteTaskEditTests {

    private let user = UUID()
    private let creator = "ffffffff-ffff-4fff-8fff-000000000003"
    private let roomID = "ffffffff-ffff-4fff-8fff-000000000009"
    private let taskID = "ffffffff-ffff-4fff-8fff-00000000002a"

    private var path: String { "/v1/rooms/\(roomID)/tasks/\(taskID)" }

    private func definitionJSON(name: String, details: String) -> String {
        """
        {"id":"\(taskID)","roomID":"\(roomID)","name":"\(name)","details":"\(details)","effort":2,"kind":"sporadic",
        "recurrence":{"kind":"none"},"assignmentPolicy":"selfAssigned","calendarAnchor":null,"endedAt":null,
        "createdByUserID":"\(creator)"}
        """
    }

    private func listing() -> String {
        """
        {"tasks":[{"definition":\(definitionJSON(name: "Trocar a lâmpada", details: "")),
        "occurrence":{"id":"ffffffff-ffff-4fff-8fff-00000000007a","taskDefinitionID":"\(taskID)",
        "availableAt":"2026-10-12T03:00:00.000Z","dueAt":null,"status":"available","completedAt":null,
        "completedByUserID":null,"effort":2},"assignment":null,"assignee":null,"suggestedAssignee":null}]}
        """
    }

    private func repository(_ server: FakeServer) -> RemoteTaskRepository {
        RemoteTaskRepository(
            api: APIClient(
                baseURL: URL(string: "http://localhost:8787")!,
                tokens: FixedToken(value: "token-teste"),
                transport: server
            )
        )
    }

    @Test func decodesTheCreatorOfASporadicTask() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me/sporadic-tasks", body: listing())
        let tasks = repository(server)
        let listed = try await tasks.sporadicTasks(in: UUID(), requesting: user)
        #expect(listed.first?.definition.createdByUserID == UUID(uuidString: creator))
    }

    @Test func updatesNameAndDetailsWithPatchAndReadsTheTaskBack() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me/sporadic-tasks", body: listing())
        let tasks = repository(server)
        _ = try await tasks.sporadicTasks(in: UUID(), requesting: user)

        await server.on("PATCH \(path)", status: 204, body: "")
        await server.on("GET \(path)", body: definitionJSON(name: "Trocar a resistência", details: "Chuveiro"))

        let updated = try await tasks.updateTaskDetails(
            id: UUID(uuidString: taskID)!, name: "Trocar a resistência", details: "Chuveiro", requestedBy: user
        )

        #expect(updated.name == "Trocar a resistência")
        #expect(await server.keys().contains("PATCH \(path)"))
        let patchIndex = try #require(await server.keys().firstIndex(of: "PATCH \(path)"))
        #expect(await server.string("name", inBody: patchIndex) == "Trocar a resistência")
        #expect(await server.string("details", inBody: patchIndex) == "Chuveiro")
    }

    @Test func sendsTheEffortAndTheRecurrenceOnlyWhenTheyChange() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me/sporadic-tasks", body: listing())
        let tasks = repository(server)
        _ = try await tasks.sporadicTasks(in: UUID(), requesting: user)
        await server.on("PATCH \(path)", status: 204, body: "")
        await server.on("GET \(path)", body: definitionJSON(name: "Louça", details: ""))
        let id = UUID(uuidString: taskID)!

        _ = try await tasks.updateTaskDetails(
            id: id, name: "Louça", details: "", effort: TaskEffort(points: 3),
            recurrence: .recurring(frequency: .monthly, interval: 1), followsRoom: nil, requestedBy: user
        )
        let first = try #require(await server.keys().firstIndex(of: "PATCH \(path)"))
        #expect(await server.bodyHas("effort", at: first))
        #expect(await server.bodyHas("recurrence", at: first))

        // A sobrecarga antiga (só nome e descrição) não manda esforço nem repetição.
        await server.on("PATCH \(path)", status: 204, body: "")
        _ = try await tasks.updateTaskDetails(id: id, name: "Louça", details: "", requestedBy: user)
        let second = try #require(await server.keys().lastIndex(of: "PATCH \(path)"))
        #expect(second != first)
        #expect(await !server.bodyHas("effort", at: second))
        #expect(await !server.bodyHas("recurrence", at: second))
        #expect(await !server.bodyHas("followsRoom", at: second))
    }

    @Test func sendsFollowsRoomOnlyWhenTheModeChanges() async throws {
        let server = FakeServer()
        let tasks = repository(server)
        let path = "/v1/rooms/\(roomID)/tasks/\(taskID)"
        await server.on("GET /v1/me/sporadic-tasks", body: listing())
        await server.on("PATCH \(path)", status: 204, body: "")
        await server.on("GET \(path)", body: definitionJSON(name: "Louça", details: ""))
        let id = UUID(uuidString: taskID)!
        _ = try await tasks.sporadicTasks(in: UUID(), requesting: user)

        _ = try await tasks.updateTaskDetails(
            id: id, name: "Louça", details: "", effort: nil,
            recurrence: .recurring(frequency: .monthly, interval: 1), followsRoom: false, requestedBy: user
        )
        let patch = try #require(await server.keys().firstIndex(of: "PATCH \(path)"))
        #expect(await server.bodyHas("followsRoom", at: patch))
        #expect(await server.bodyHas("recurrence", at: patch))
    }

    @Test func deletesASporadicTaskWithDelete() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me/sporadic-tasks", body: listing())
        let tasks = repository(server)
        _ = try await tasks.sporadicTasks(in: UUID(), requesting: user)

        await server.on("DELETE \(path)", status: 204, body: "")
        try await tasks.deleteSporadicTask(id: UUID(uuidString: taskID)!, requestedBy: user)

        #expect(await server.keys().last == "DELETE \(path)")
    }
}
