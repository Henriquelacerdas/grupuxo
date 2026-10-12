// swiftlint:disable all
import Amplify
import Foundation

public struct HouseRecord: Model {
  public let id: String
  public var name: String
  public var ownerId: String
  public var members: [String]
  public var createdAt: Temporal.DateTime?
  public var updatedAt: Temporal.DateTime?
  
  public init(id: String = UUID().uuidString,
      name: String,
      ownerId: String,
      members: [String]) {
    self.init(id: id,
      name: name,
      ownerId: ownerId,
      members: members,
      createdAt: nil,
      updatedAt: nil)
  }
  internal init(id: String = UUID().uuidString,
      name: String,
      ownerId: String,
      members: [String],
      createdAt: Temporal.DateTime? = nil,
      updatedAt: Temporal.DateTime? = nil) {
      self.id = id
      self.name = name
      self.ownerId = ownerId
      self.members = members
      self.createdAt = createdAt
      self.updatedAt = updatedAt
  }
}