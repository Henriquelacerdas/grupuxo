import Foundation

protocol TaskRepository: Sendable {
    func tasks(for userID: User.ID, in houseID: House.ID) async throws -> [TaskItem]
    func tasks(in roomID: Room.ID, requesting userID: User.ID) async throws -> [TaskItem]
    func sporadicTasks(in houseID: House.ID, requesting userID: User.ID) async throws -> [TaskItem]
    func create(_ definition: TaskDefinition, at date: Date) async throws -> TaskDefinition
    func refreshSchedule(in houseID: House.ID, at date: Date) async throws
    func addMember(userID: User.ID, to roomID: Room.ID, at date: Date) async throws
    func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws
    func claim(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws
    func release(occurrenceID: TaskOccurrence.ID, by userID: User.ID) async throws
}
