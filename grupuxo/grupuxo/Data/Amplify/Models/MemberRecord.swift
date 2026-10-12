// swiftlint:disable all
import Amplify
import Foundation

public struct MemberRecord: Model {
  public let id: String
  public var houseId: String
  public var userId: String?
  public var name: String
  public var role: String
  public var members: [String]
  public var createdAt: Temporal.DateTime?
  public var updatedAt: Temporal.DateTime?
  
  public init(id: String = UUID().uuidString,
      houseId: String,
      userId: String? = nil,
      name: String,
      role: String,
      members: [String]) {
    self.init(id: id,
      houseId: houseId,
      userId: userId,
      name: name,
      role: role,
      members: members,
      createdAt: nil,
      updatedAt: nil)
  }
  internal init(id: String = UUID().uuidString,
      houseId: String,
      userId: String? = nil,
      name: String,
      role: String,
      members: [String],
      createdAt: Temporal.DateTime? = nil,
      updatedAt: Temporal.DateTime? = nil) {
      self.id = id
      self.houseId = houseId
      self.userId = userId
      self.name = name
      self.role = role
      self.members = members
      self.createdAt = createdAt
      self.updatedAt = updatedAt
  }
}