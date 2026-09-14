import Foundation

protocol TaskRepository: Sendable {
    func tasks(for userID: User.ID, in houseID: House.ID) async throws -> [TaskItem]
    func tasks(in roomID: Room.ID, requesting userID: User.ID) async throws -> [TaskItem]
    func sporadicTasks(in houseID: House.ID, requesting userID: User.ID) async throws -> [TaskItem]
    func create(_ definition: TaskDefinition) async throws -> TaskDefinition
    func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws
    func claim(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws
    func release(occurrenceID: TaskOccurrence.ID, by userID: User.ID) async throws
}
