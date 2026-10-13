import Foundation
import Testing
@testable import GrupuxoDomain
@testable import grupuxo

// Fixtures da `api` (as mesmas que o teste TS `backend/test/api-contract.test.ts` compara com as respostas reais).
private func fixture(_ name: String) throws -> Data {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    return try Data(contentsOf: root.appendingPathComponent("backend/test/fixtures/api/\(name).json"))
}

private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
    try APIClient.makeDecoder().decode(type, from: try fixture(name))
}

struct FixedToken: AccessTokenProvider {
    var value: String? = "token-teste"

    func accessToken() async throws -> String {
        guard let value else { throw APIError.unauthorized }
        return value
    }
}

/// Servidor falso: responde por "MÉTODO caminho" e guarda o que recebeu.
actor FakeServer: HTTPTransport {
    struct Reply: Sendable {
        let status: Int
        let body: String
    }

    private var replies: [String: Reply] = [:]
    private(set) var requests: [URLRequest] = []
    private var failure: (any Error)?

    func on(_ key: String, status: Int = 200, body: String = "{}") {
        replies[key] = Reply(status: status, body: body)
    }

    func fail(with error: any Error) {
        failure = error
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        if let failure { throw failure }
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        guard let reply = replies[key] else { throw URLError(.cannotConnectToHost) }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
        return (Data(reply.body.utf8), response)
    }

    func keys() -> [String] {
        requests.map { "\($0.httpMethod ?? "GET") \($0.url?.path ?? "")" }
    }

    private func object(_ index: Int) -> [String: Any]? {
        guard requests.indices.contains(index), let data = requests[index].httpBody else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    func string(_ key: String, inBody index: Int) -> String? {
        object(index)?[key] as? String
    }

    func strings(_ key: String, inBody index: Int) -> [String]? {
        object(index)?[key] as? [String]
    }

    func bodyHas(_ key: String, at index: Int) -> Bool {
        object(index)?[key] != nil
    }
}

private let baseURL = URL(string: "http://localhost:8787")!

private func client(_ server: FakeServer, token: String? = "token-teste") -> APIClient {
    APIClient(baseURL: baseURL, tokens: FixedToken(value: token), transport: server)
}

struct RemoteDTOTests {
    @Test func decodesMyHouse() throws {
        let mine = try decode(MyHouseDTO.self, "me-house")
        #expect(mine.house.domain.name == "Nossa casa")
        #expect(mine.house.domain.accessCode == "GRUPUXO")
        #expect(mine.members.count == 4)
        #expect(mine.rooms.count == 6)
        let whole = mine.rooms[0].domain
        #expect(whole.kind == .wholeHouse)
        #expect(whole.calendarAnchor != nil)
        #expect(mine.rooms.contains { $0.domain.visibility == .privateRoom })
    }

    @Test func decodesMillisecondDates() throws {
        let house = try decode(HouseDTO.self, "house")
        #expect(house.createdAt == Date(timeIntervalSince1970: 1_791_979_200))
    }

    @Test func decodesRoomParticipation() throws {
        let participation = try decode(RoomParticipationDTO.self, "room-participation").domain
        #expect(participation.isMember)
        #expect(participation.memberCount == 4)
        #expect(participation.responsibleNames == ["Bia"])
        #expect(participation.periodEnd.timeIntervalSince(participation.periodStart) == 7 * 24 * 3600)
    }

    @Test func decodesRoomWithoutAnchor() throws {
        #expect(try decode(RoomDTO.self, "room").domain.calendarAnchor == nil)
    }

    @Test func decodesTaskDefinition() throws {
        let definition = try decode(TaskDefinitionDTO.self, "task-definition").domain()
        #expect(definition.name == "Aspirar a sala")
        #expect(definition.effort.points == 2)
        #expect(definition.recurrence == .recurring(frequency: .weekly, interval: 1))
        #expect(definition.assignmentPolicy == .calendarRotation)
        #expect(definition.endedAt == nil)
    }

    @Test func decodesTaskItems() throws {
        let assigned = try decode(TaskItemDTO.self, "task-item").domain()
        #expect(assigned.assignee?.name == "Marina")
        #expect(assigned.assignment?.occurrenceID == assigned.occurrence.id)
        #expect(assigned.occurrence.status == .assigned)

        let sporadic = try decode(TaskItemDTO.self, "task-item-sporadic").domain()
        #expect(sporadic.definition.kind == .sporadic)
        #expect(sporadic.definition.recurrence == RecurrencePolicy.none)
        #expect(sporadic.assignment == nil)
        #expect(sporadic.suggestedAssignee?.name == "Marina")

        let completed = try decode(TaskItemDTO.self, "task-item-completed").domain()
        #expect(completed.occurrence.isCompleted)
        #expect(completed.occurrence.completedAt != nil)
    }

    @Test func recurrenceRoundTripsThroughTheRequestFormat() throws {
        let weekly = RecurrencePolicy.weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 3))
        let data = try JSONEncoder().encode(RecurrenceDTO(weekly))
        let decoded = try JSONDecoder().decode(RecurrenceDTO.self, from: data)
        #expect(decoded.domain == weekly)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["kind"] as? String == "weekly")
        #expect(object["frequency"] == nil)
    }
}

struct APIClientTests {
    @Test func sendsBearerTokenAndLowercasePath() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", body: #"{"id":"ffffffff-ffff-4fff-8fff-000000000001"}"#)
        let account = try await client(server).get(RegisteredAccountDTO.self, "v1/me")
        #expect(account.id.apiString == "ffffffff-ffff-4fff-8fff-000000000001")
        let request = try #require(await server.requests.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-teste")
        #expect(request.url?.absoluteString == "http://localhost:8787/v1/me")
    }

    @Test func mapsUnauthorizedAndErrorCodes() async throws {
        let server = FakeServer()
        await server.on("GET /v1/a", status: 401, body: #"{"error":"unauthorized"}"#)
        await server.on("GET /v1/b", status: 404, body: #"{"error":"no_house"}"#)
        await server.on("GET /v1/c", status: 500, body: "")
        let api = client(server)
        await #expect(throws: APIError.unauthorized) { try await api.send("GET", "v1/a") }
        await #expect(throws: APIError.http(status: 404, code: "no_house")) { try await api.send("GET", "v1/b") }
        await #expect(throws: APIError.http(status: 500, code: "")) { try await api.send("GET", "v1/c") }
    }

    @Test func networkFailureAndMissingTokenAndBadBody() async throws {
        let server = FakeServer()
        await server.fail(with: URLError(.notConnectedToInternet))
        await #expect(throws: APIError.network) { try await client(server).send("GET", "v1/me") }

        let ok = FakeServer()
        await ok.on("GET /v1/me", body: "nao e json")
        await #expect(throws: APIError.invalidResponse) {
            try await client(ok).get(RegisteredAccountDTO.self, "v1/me")
        }
        await #expect(throws: APIError.unauthorized) { try await client(ok, token: nil).send("GET", "v1/me") }
        #expect(await ok.requests.count == 1, "sem token a requisição nem sai")
    }

    @Test func encodesQueryAndBody() async throws {
        let server = FakeServer()
        await server.on("DELETE /v1/me/house", status: 204, body: "")
        try await client(server).send("DELETE", "v1/me/house", query: ["confirmRoomDeletion": "true"])
        #expect(await server.requests.first?.url?.query == "confirmRoomDeletion=true")
    }

    @Test func configurationFailsClosedWithoutAddress() {
        #expect(throws: APIConfiguration.ConfigurationError.missing) { try APIConfiguration(bundle: Bundle(for: BundleToken.self)) }
    }

    private final class BundleToken {}
}

@MainActor
struct RemoteHouseSessionTests {
    private let meJSON = #"{"id":"ffffffff-ffff-4fff-8fff-000000000001"}"#

    private func session(_ server: FakeServer) -> RemoteHouseSession {
        RemoteHouseSession(api: client(server))
    }

    @Test func newAccountWithoutRegistrationGoesToOnboarding() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", status: 403, body: #"{"error":"account_not_registered"}"#)
        let houses = session(server)
        await houses.load()
        #expect(houses.hasLoaded)
        #expect(houses.me == nil)
        #expect(houses.house == nil)
        #expect(houses.loadError == nil)
    }

    @Test func registeredAccountWithoutHouseGoesToOnboarding() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", body: meJSON)
        await server.on("GET /v1/me/house", status: 404, body: #"{"error":"no_house"}"#)
        let houses = session(server)
        await houses.load()
        #expect(houses.me != nil)
        #expect(houses.house == nil)
        #expect(houses.loadError == nil)
    }

    @Test func loadsTheHouseAndFindsMyName() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", body: meJSON)
        await server.on("GET /v1/me/house", body: String(decoding: try fixture("me-house"), as: UTF8.self))
        let houses = session(server)
        await houses.load()
        #expect(houses.house?.name == "Nossa casa")
        #expect(houses.inviteCode == "GRUPUXO")
        #expect(houses.rooms.count == 6)
        #expect(houses.members.count == 4)
        #expect(houses.me?.name == "Marina")
    }

    @Test func createHouseRegistersTheAccountFirst() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", status: 403, body: #"{"error":"account_not_registered"}"#)
        await server.on("POST /v1/me", body: meJSON)
        await server.on("POST /v1/houses", status: 201, body: String(decoding: try fixture("me-house"), as: UTF8.self))
        let houses = session(server)
        await houses.load()
        await houses.createHouse(name: " Nossa casa ", myName: " Marina ")
        #expect(await server.keys() == ["GET /v1/me", "POST /v1/me", "POST /v1/houses"])
        #expect(await server.string("name", inBody: 1) == "Marina")
        #expect(await server.string("name", inBody: 2) == "Nossa casa")
        #expect(await server.string("timezone", inBody: 2) == TimeZone.current.identifier)
        #expect(houses.house?.name == "Nossa casa")
        #expect(houses.errorMessage == nil)
    }

    @Test func joinWithInvalidCodeShowsTheMessage() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", body: meJSON)
        await server.on("GET /v1/me/house", status: 404, body: #"{"error":"no_house"}"#)
        await server.on("POST /v1/houses/join", status: 404, body: #"{"error":"invalid_code"}"#)
        let houses = session(server)
        await houses.load()
        await houses.joinHouse(code: "abc234", myName: "Ana")
        #expect(await server.string("code", inBody: 2) == "ABC234")
        #expect(houses.errorMessage == "Código de convite inválido.")
        #expect(houses.house == nil)
    }

    @Test func leaveAsksForConfirmationWhenRoomsWouldBeDeleted() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", body: meJSON)
        await server.on("GET /v1/me/house", body: String(decoding: try fixture("me-house"), as: UTF8.self))
        await server.on("DELETE /v1/me/house", status: 409, body: #"{"error":"room_deletion_confirmation_required"}"#)
        let houses = session(server)
        await houses.load()
        await houses.leaveHouse()
        #expect(houses.leaveNeedsConfirmation)
        #expect(houses.house != nil)

        await server.on("DELETE /v1/me/house", status: 204, body: "")
        await houses.leaveHouse(confirmRoomDeletion: true)
        #expect(houses.house == nil)
        #expect(await server.requests.last?.url?.query == "confirmRoomDeletion=true")
    }

    @Test func expiredTokenReportsSessionExpired() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", status: 401, body: #"{"error":"unauthorized"}"#)
        let houses = session(server)
        await houses.load()
        #expect(houses.loadError == .sessionExpired)
    }

    @Test func missingConfigurationFailsClosed() async {
        let houses = RemoteHouseSession(api: nil)
        await houses.load()
        guard case .failed = houses.loadError else {
            Issue.record("esperava falha de configuração")
            return
        }
    }

    @Test func resetForgetsEverything() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me", body: meJSON)
        await server.on("GET /v1/me/house", body: String(decoding: try fixture("me-house"), as: UTF8.self))
        let houses = session(server)
        await houses.load()
        houses.reset()
        #expect(houses.house == nil && houses.me == nil && !houses.hasLoaded)
    }
}

struct RemoteRepositoryTests {
    private let user = UUID()
    private let roomID = UUID(uuidString: "FFFFFFFF-FFFF-4FFF-8FFF-000000000009")!

    @Test func completeAndReopenUseLowercaseOccurrenceIDs() async throws {
        let server = FakeServer()
        let occurrence = UUID(uuidString: "FFFFFFFF-FFFF-4FFF-8FFF-000000000085")!
        await server.on("POST /v1/occurrences/ffffffff-ffff-4fff-8fff-000000000085/complete", status: 204, body: "")
        await server.on("POST /v1/occurrences/ffffffff-ffff-4fff-8fff-000000000085/reopen", status: 204, body: "")
        let tasks = RemoteTaskRepository(api: client(server))
        try await tasks.complete(occurrenceID: occurrence, by: user, at: .now)
        try await tasks.reopen(occurrenceID: occurrence, by: user)
        #expect(await server.keys().count == 2)
    }

    @Test func endTaskFindsTheRoomOfAPreviouslyListedTask() async throws {
        let server = FakeServer()
        await server.on("GET /v1/rooms/\(roomID.apiString)/tasks", body: #"{"tasks":[\#(String(decoding: try fixture("task-item"), as: UTF8.self))]}"#)
        let tasks = RemoteTaskRepository(api: client(server))
        let listed = try await tasks.tasks(in: roomID, requesting: user)
        let task = try #require(listed.first)
        await server.on(
            "POST /v1/rooms/\(task.definition.roomID.apiString)/tasks/\(task.definition.id.apiString)/end", status: 204, body: ""
        )
        try await tasks.endTask(task.definition.id, requestedBy: user, at: .now)
        #expect(await server.keys().last?.hasSuffix("/end") == true)
    }

    @Test func unknownTaskIsNotFoundWithoutCallingTheServer() async throws {
        let server = FakeServer()
        let tasks = RemoteTaskRepository(api: client(server))
        await #expect(throws: DomainError.entityNotFound) {
            try await tasks.taskDefinition(id: UUID(), requesting: user)
        }
        #expect(await server.requests.isEmpty)
    }

    @Test func routesWithoutServerSupportFailExplicitly() async throws {
        let tasks = RemoteTaskRepository(api: client(FakeServer()))
        await #expect(throws: APIError.unsupported) { try await tasks.claim(occurrenceID: UUID(), by: user, at: .now) }
        await #expect(throws: APIError.unsupported) {
            try await tasks.updateTaskDetails(id: UUID(), name: "x", details: "", requestedBy: user)
        }
        #expect(try await tasks.sporadicTasks(in: UUID(), requesting: user).isEmpty)
    }

    @Test func createRoomSendsParticipantsOnlyForPrivateRooms() async throws {
        let server = FakeServer()
        let houseID = UUID()
        let created = String(decoding: try fixture("room"), as: UTF8.self)
        await server.on("POST /v1/houses/\(houseID.apiString)/rooms", status: 201, body: created)
        let rooms = RemoteRoomRepository(api: client(server))
        let other = UUID()
        let privateRoom = Room(id: UUID(), houseID: houseID, name: "Escritório", kind: .standard, visibility: .privateRoom)
        _ = try await rooms.create(privateRoom, memberships: [RoomMembership(id: UUID(), roomID: privateRoom.id, userID: other)])
        #expect(await server.strings("participantIDs", inBody: 0) == [other.apiString])

        let commonRoom = Room(id: UUID(), houseID: houseID, name: "Sala", kind: .standard, visibility: .common)
        let result = try await rooms.create(commonRoom, memberships: [RoomMembership(id: UUID(), roomID: commonRoom.id, userID: other)])
        #expect(await !server.bodyHas("participantIDs", at: 1))
        #expect(result.name == "Cozinha", "devolve o cômodo criado pelo servidor, com o id dele")
    }

    @Test func whatsAppInvitationAndConnection() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me/whatsapp", body: #"{"linked":false}"#)
        let repository = RemoteWhatsAppConnectionRepository(api: client(server))
        #expect(try await repository.connection() == nil)

        await server.on("GET /v1/me/whatsapp", body: #"{"linked":true,"phone":"+55•••••••8888","linkedAt":"2026-10-14T12:00:00.000Z"}"#)
        #expect(try await repository.connection()?.maskedPhone == "+55•••••••8888")

        await server.on("POST /v1/me/whatsapp/link", body: #"{"url":"https://wa.me/5511900000000?text=oi","expiresAt":"2026-10-14T12:15:00.000Z"}"#)
        #expect(try await repository.createInvitation().url.host() == "wa.me")

        await server.on("POST /v1/me/whatsapp/link", status: 409, body: #"{"error":"already_linked"}"#)
        await #expect(throws: WhatsAppConnectionError.alreadyLinked) { try await repository.createInvitation() }
    }

    @Test func houseRepositoryReadsFromMyHouse() async throws {
        let server = FakeServer()
        await server.on("GET /v1/me/house", body: String(decoding: try fixture("me-house"), as: UTF8.self))
        let houses = RemoteHouseRepository(api: client(server))
        let mine = try await houses.houses(for: user)
        let house = try #require(mine.first)
        #expect(try await houses.memberIDs(in: house.id).count == 4)
        await #expect(throws: DomainError.entityNotFound) { try await houses.house(id: UUID()) }
        await server.on("GET /v1/me/house", status: 404, body: #"{"error":"no_house"}"#)
        #expect(try await houses.houses(for: user).isEmpty)
    }
}
