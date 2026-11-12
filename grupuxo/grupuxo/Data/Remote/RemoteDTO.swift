import Foundation
import GrupuxoDomain

// Formato JSON da `api` (BACKEND.md seção 6.1; exemplos executáveis em `backend/test/fixtures/api/`).
// O servidor não expõe campos internos do agendamento: o app preenche os padrões do domínio.

struct UserDTO: Decodable, Sendable {
    let id: UUID
    let name: String
    /// Servidor anterior não manda o campo: sem foto.
    let photoURL: URL?

    var domain: User { User(id: id, name: name, email: nil, photoURL: photoURL) }
}

/// Resposta de `POST /v1/me/photo`: onde o app envia o JPEG (PUT pré-assinado, 5 minutos).
struct PhotoUploadTargetDTO: Decodable, Sendable {
    let key: String
    let uploadURL: URL
    let headers: [String: String]
}

struct ConfirmPhotoBody: Encodable, Sendable { let key: String }

/// Corpo de `PUT /v1/me/devices`.
struct DeviceBody: Encodable, Sendable {
    let token: String
    let environment: String
}

/// Preferências de push (`GET`/`PUT /v1/me/notification-preferences`).
struct NotificationPreferencesDTO: Codable, Equatable, Sendable {
    var remindTasks: Bool
    var reminderHour: Int
    var cycleTurned: Bool
    var houseActivity: Bool
    var weeklySummary: Bool
}

struct HouseDTO: Decodable, Sendable {
    let id: UUID
    let name: String
    let accessCode: String
    let timezone: String
    let createdAt: Date

    var domain: House { House(id: id, name: name, accessCode: accessCode, createdAt: createdAt) }
}

struct PeriodicityDTO: Codable, Sendable {
    let executionsPerPeriod: Int
    let intervalWeeks: Int

    init(_ value: WeeklyPeriodicity) {
        executionsPerPeriod = value.executionsPerPeriod
        intervalWeeks = value.intervalWeeks
    }

    var domain: WeeklyPeriodicity {
        WeeklyPeriodicity(executionsPerPeriod: executionsPerPeriod, intervalWeeks: intervalWeeks)
    }
}

struct RoomDTO: Decodable, Sendable {
    let id: UUID
    let houseID: UUID
    let name: String
    let kind: RoomKind
    let category: RoomCategory
    let visibility: RoomVisibility
    let periodicity: PeriodicityDTO
    let responsibleCount: Int
    let calendarAnchor: Date?
    let icon: String
    let color: RoomColor

    var domain: Room {
        Room(
            id: id, houseID: houseID, name: name, kind: kind, category: category, visibility: visibility,
            periodicity: periodicity.domain, responsibleCount: responsibleCount, calendarAnchor: calendarAnchor,
            icon: icon, color: color
        )
    }
}

struct MyHouseDTO: Decodable, Sendable {
    let house: HouseDTO
    let members: [UserDTO]
    let rooms: [RoomDTO]
}

struct RoomParticipationDTO: Decodable, Sendable {
    let room: RoomDTO
    let isMember: Bool
    let memberCount: Int
    let responsibleNames: [String]
    /// Ausente em servidor que ainda não publicou a previsão.
    let nextResponsibleNames: [String]?
    let periodStart: Date
    let periodEnd: Date

    var domain: RoomParticipation {
        RoomParticipation(
            room: room.domain, isMember: isMember, memberCount: memberCount,
            responsibleNames: responsibleNames, nextResponsibleNames: nextResponsibleNames ?? [],
            periodStart: periodStart, periodEnd: periodEnd
        )
    }
}

/// `{ kind: "none" }`, `{ kind: "recurring", frequency, interval }` ou `{ kind: "weekly", periodicity }`.
struct RecurrenceDTO: Codable, Sendable {
    let kind: String
    let frequency: RecurrenceFrequency?
    let interval: Int?
    let periodicity: PeriodicityDTO?

    init(_ policy: RecurrencePolicy) {
        switch policy {
        case .none:
            (kind, frequency, interval, periodicity) = ("none", nil, nil, nil)
        case let .recurring(frequency, interval):
            (kind, self.frequency, self.interval, periodicity) = ("recurring", frequency, interval, nil)
        case let .weekly(value):
            (kind, frequency, interval, periodicity) = ("weekly", nil, nil, PeriodicityDTO(value))
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(kind, forKey: .kind)
        try values.encodeIfPresent(frequency, forKey: .frequency)
        try values.encodeIfPresent(interval, forKey: .interval)
        try values.encodeIfPresent(periodicity, forKey: .periodicity)
    }

    var domain: RecurrencePolicy? {
        switch kind {
        // `RecurrencePolicy.none` explícito: um `.none` solto viraria `Optional.none`.
        case "none": RecurrencePolicy.none
        case "recurring":
            if let frequency, let interval { .recurring(frequency: frequency, interval: interval) } else { nil }
        case "weekly":
            periodicity.map { .weekly($0.domain) }
        default: nil
        }
    }
}

struct TaskDefinitionDTO: Decodable, Sendable {
    let id: UUID
    let roomID: UUID
    let name: String
    let details: String
    let effort: Int
    let kind: TaskKind
    let recurrence: RecurrenceDTO
    let assignmentPolicy: TaskAssignmentPolicy
    let calendarAnchor: Date?
    let endedAt: Date?
    /// Quem criou a tarefa avulsa; ausente nas tarefas antigas (sem Editar/Excluir) e nas recorrentes.
    let createdByUserID: UUID?
    /// "Repetir com o cômodo"; `null` ou ausente = definição antiga (vale a periodicidade).
    let followsRoom: Bool?

    func domain() throws -> TaskDefinition {
        guard let recurrence = recurrence.domain else { throw APIError.invalidResponse }
        return TaskDefinition(
            id: id, roomID: roomID, name: name, details: details, effort: TaskEffort(points: effort),
            kind: kind, recurrence: recurrence, assignmentPolicy: assignmentPolicy,
            createdByUserID: createdByUserID, calendarAnchor: calendarAnchor, endedAt: endedAt,
            followsRoom: followsRoom
        )
    }
}

struct TaskOccurrenceDTO: Decodable, Sendable {
    let id: UUID
    let taskDefinitionID: UUID
    let availableAt: Date
    let dueAt: Date?
    let status: TaskOccurrenceStatus
    let completedAt: Date?
    let completedByUserID: UUID?
    let effort: Int

    var domain: TaskOccurrence {
        TaskOccurrence(
            id: id, taskDefinitionID: taskDefinitionID, availableAt: availableAt, dueAt: dueAt, status: status,
            completedAt: completedAt, completedByUserID: completedByUserID, effortSnapshot: TaskEffort(points: effort)
        )
    }
}

struct TaskAssignmentDTO: Decodable, Sendable {
    let id: UUID
    let userID: UUID
    let assignedAt: Date
    let endedAt: Date?

    func domain(occurrenceID: UUID) -> TaskAssignment {
        TaskAssignment(id: id, occurrenceID: occurrenceID, userID: userID, assignedAt: assignedAt, endedAt: endedAt)
    }
}

struct TaskItemDTO: Decodable, Sendable {
    let definition: TaskDefinitionDTO
    let occurrence: TaskOccurrenceDTO
    let assignment: TaskAssignmentDTO?
    let assignee: UserDTO?
    let suggestedAssignee: UserDTO?

    func domain() throws -> TaskItem {
        TaskItem(
            definition: try definition.domain(),
            occurrence: occurrence.domain,
            assignment: assignment?.domain(occurrenceID: occurrence.id),
            assignee: assignee?.domain,
            suggestedAssignee: suggestedAssignee?.domain
        )
    }
}

struct TaskListDTO: Decodable, Sendable {
    let tasks: [TaskItemDTO]
}

struct TaskSwapRequestDTO: Decodable, Sendable {
    let id: UUID
    let requesterID: UUID
    let receiverID: UUID
    let offeredOccurrenceID: UUID
    let requestedOccurrenceID: UUID
    let status: TaskSwapRequestStatus
    let createdAt: Date
    let resolvedAt: Date?

    var domain: TaskSwapRequest {
        TaskSwapRequest(
            id: id, requesterID: requesterID, receiverID: receiverID, offeredOccurrenceID: offeredOccurrenceID,
            requestedOccurrenceID: requestedOccurrenceID, status: status, createdAt: createdAt, resolvedAt: resolvedAt
        )
    }
}

struct MySwapsDTO: Decodable, Sendable {
    let incoming: [TaskSwapRequestDTO]
    let outgoing: [TaskSwapRequestDTO]
}

struct NotificationDTO: Decodable, Sendable {
    let id: UUID
    let kind: AppNotificationKind
    let swapRequestID: UUID?
    let taskDefinitionID: UUID?
    let roomID: UUID?
    let actorUserID: UUID?
    let subjectName: String?
    let createdAt: Date
    let readAt: Date?

    /// O destinatário é sempre quem chamou: o servidor não repete o id.
    func domain(recipientUserID: User.ID) -> AppNotification {
        AppNotification(
            id: id, recipientUserID: recipientUserID, kind: kind, swapRequestID: swapRequestID,
            taskDefinitionID: taskDefinitionID, roomID: roomID, actorUserID: actorUserID,
            subjectName: subjectName, createdAt: createdAt, readAt: readAt
        )
    }
}

/// Lista de avisos. Um tipo que este app ainda não conhece (servidor mais novo) é ignorado, não derruba a lista.
struct NotificationListDTO: Decodable, Sendable {
    let notifications: [NotificationDTO]

    private enum CodingKeys: String, CodingKey { case notifications }

    private struct Skipped: Decodable {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        var items = try container.nestedUnkeyedContainer(forKey: .notifications)
        var result: [NotificationDTO] = []
        while !items.isAtEnd {
            if let item = try? items.decode(NotificationDTO.self) {
                result.append(item)
            } else {
                _ = try? items.decode(Skipped.self)
            }
        }
        notifications = result
    }
}

struct VacationDTO: Decodable, Sendable {
    let onVacation: Bool
    let startsAt: Date?

    var domain: VacationStatus { VacationStatus(isOn: onVacation, startsAt: startsAt) }
}

struct PendingRoomAccessDTO: Decodable, Sendable {
    let roomIDs: [UUID]
}

struct RegisteredAccountDTO: Decodable, Sendable {
    let id: UUID
}

struct WhatsAppStatusDTO: Decodable, Sendable {
    let linked: Bool
    let phone: String?
    let linkedAt: Date?
}

struct WhatsAppInvitationDTO: Decodable, Sendable {
    let url: URL
    let expiresAt: Date
}

// MARK: - Corpos das requisições

struct RegisterAccountBody: Encodable, Sendable { let name: String }

/// Corpo de `PATCH /v1/me` e de `PATCH /v1/houses/{id}`.
struct RenameBody: Encodable, Sendable { let name: String }

struct CreateHouseBody: Encodable, Sendable {
    let name: String
    let timezone: String
}

struct JoinHouseBody: Encodable, Sendable { let code: String }

struct CreateRoomBody: Encodable, Sendable {
    let name: String
    let visibility: RoomVisibility
    let category: RoomCategory
    let periodicity: PeriodicityDTO
    let responsibleCount: Int
    let icon: String
    let color: RoomColor
    /// Só vale em cômodo privado.
    let participantIDs: [String]?
}

/// Corpo de `PATCH /v1/rooms/{id}`: o que é `nil` não vai no JSON e não muda.
struct UpdateRoomBody: Encodable, Sendable {
    let name: String?
    let category: RoomCategory?
    let icon: String?
    let color: RoomColor?
    let periodicity: PeriodicityDTO?
    let responsibleCount: Int?

    init(_ patch: RoomPatch) {
        name = patch.name
        category = patch.category
        icon = patch.icon
        color = patch.color
        periodicity = patch.periodicity.map(PeriodicityDTO.init)
        responsibleCount = patch.responsibleCount
    }
}

struct CreateTaskBody: Encodable, Sendable {
    let name: String
    let details: String
    let effort: Int
    let kind: TaskKind
    let recurrence: RecurrenceDTO
    let assignmentPolicy: TaskAssignmentPolicy
    /// "Repetir com o cômodo" (só tarefa recorrente); `nil` não vai no JSON.
    let followsRoom: Bool?
}

struct UpdateTaskBody: Encodable, Sendable {
    let name: String
    let details: String
    /// 1 a 3; `nil` não vai no JSON e não muda.
    let effort: Int?
    /// Só a repetição própria muda o intervalo; `nil` não vai no JSON.
    let recurrence: RecurrenceDTO?
    /// Passa entre "Repetir com o cômodo" e repetição própria; `nil` não vai no JSON e não muda.
    let followsRoom: Bool?

    init(name: String, details: String, effort: Int? = nil, recurrence: RecurrenceDTO? = nil, followsRoom: Bool? = nil) {
        self.name = name
        self.details = details
        self.effort = effort
        self.recurrence = recurrence
        self.followsRoom = followsRoom
    }
}

struct RoomMemberBody: Encodable, Sendable { let userID: String }

struct CreateSwapBody: Encodable, Sendable {
    let offeredOccurrenceID: String
    let requestedOccurrenceID: String
}

/// Uma carga da casa atende às telas de tarefas, casa e cômodo.
struct HouseSnapshotDTO: Decodable, Sendable {
    let userID: UUID
    let home: MyHouseDTO
    let participations: [RoomParticipationDTO]
    let roomTasks: [TaskItemDTO]
    let myTasks: [TaskItemDTO]
    let sporadicTasks: [TaskItemDTO]
    /// Servidor anterior não manda o campo: nenhum pedido.
    let pendingRoomAccessIDs: [UUID]?

    func domain() throws -> RemoteHouseSnapshot {
        RemoteHouseSnapshot(
            userID: userID, home: home, participations: participations.map(\.domain),
            roomTasks: try roomTasks.map { try $0.domain() },
            myTasks: try myTasks.map { try $0.domain() },
            sporadicTasks: try sporadicTasks.map { try $0.domain() },
            pendingRoomAccessIDs: Set(pendingRoomAccessIDs ?? [])
        )
    }
}

struct RemoteHouseSnapshot: Sendable {
    let userID: UUID
    let home: MyHouseDTO
    let participations: [RoomParticipation]
    let roomTasks: [TaskItem]
    let myTasks: [TaskItem]
    let sporadicTasks: [TaskItem]
    let pendingRoomAccessIDs: Set<Room.ID>
}

// MARK: - Avaliar a semana

struct PendingRatingDTO: Decodable, Sendable {
    let roomID: UUID
    let roomName: String
    let periodStart: Date
    let periodEnd: Date
    let windowEnd: Date

    var domain: PendingRating {
        PendingRating(roomID: roomID, roomName: roomName, periodStart: periodStart, periodEnd: periodEnd, windowEnd: windowEnd)
    }
}

struct PendingRatingsDTO: Decodable, Sendable {
    let pending: [PendingRatingDTO]
}

struct RoomWeekResultDTO: Decodable, Sendable {
    let roomID: UUID
    let roomName: String
    let periodStart: Date
    let periodEnd: Date
    let ratingCount: Int
    let level: RatingLevel?
    let tags: [RatingTag]
    let responsibleUserIDs: [UUID]
    let responsibleNames: [String]

    var domain: RoomWeekResult {
        RoomWeekResult(
            roomID: roomID, roomName: roomName, periodStart: periodStart, periodEnd: periodEnd, ratingCount: ratingCount,
            level: level, tags: tags, responsibleUserIDs: responsibleUserIDs, responsibleNames: responsibleNames
        )
    }
}

struct RatingSummaryDTO: Decodable, Sendable {

    struct Week: Decodable, Sendable {
        let start: Date
        let end: Date
        let tasksDone: Int
        let tasksTotal: Int
    }

    struct Upcoming: Decodable, Sendable {
        let roomName: String
    }

    let week: Week
    let mine: [RoomWeekResultDTO]
    let house: [RoomWeekResultDTO]
    let upcoming: [Upcoming]

    var domain: WeekSummary {
        WeekSummary(
            weekStart: week.start, weekEnd: week.end, tasksDone: week.tasksDone, tasksTotal: week.tasksTotal,
            mine: mine.map(\.domain), house: house.map(\.domain), upcomingRoomNames: upcoming.map(\.roomName)
        )
    }
}

/// Corpo de `POST /v1/rooms/{id}/ratings`; `periodStart` é o instante exato que o servidor mandou, em ISO com milissegundos.
struct RateRoomBody: Encodable, Sendable {
    let periodStart: String
    let level: RatingLevel
    let tags: [RatingTag]
}
