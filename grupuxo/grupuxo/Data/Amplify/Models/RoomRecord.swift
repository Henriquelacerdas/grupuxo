// swiftlint:disable all
import Amplify
import Foundation

public struct RoomRecord: Model {
  public let id: String
  public var houseId: String
  public var name: String
  public var members: [String]
  public var createdAt: Temporal.DateTime?
  public var updatedAt: Temporal.DateTime?
  
  public init(id: String = UUID().uuidString,
      houseId: String,
      name: String,
      members: [String]) {
    self.init(id: id,
      houseId: houseId,
      name: name,
      members: members,
      createdAt: nil,
      updatedAt: nil)
  }
  internal init(id: String = UUID().uuidString,
      houseId: String,
      name: String,
      members: [String],
      createdAt: Temporal.DateTime? = nil,
      updatedAt: Temporal.DateTime? = nil) {
      self.id = id
      self.houseId = houseId
      self.name = name
      self.members = members
      self.createdAt = createdAt
      self.updatedAt = updatedAt
  }
}