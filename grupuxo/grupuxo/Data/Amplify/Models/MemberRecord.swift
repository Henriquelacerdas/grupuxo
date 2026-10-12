// swiftlint:disable all
import Amplify
import Foundation

public struct MemberRecord: Model {
  public let id: String
  public var houseId: String
  public var userId: String?
  public var name: String
  public var role: String
  public var createdAt: Temporal.DateTime?
  public var updatedAt: Temporal.DateTime?
  
  public init(id: String = UUID().uuidString,
      houseId: String,
      userId: String? = nil,
      name: String,
      role: String) {
    self.init(id: id,
      houseId: houseId,
      userId: userId,
      name: name,
      role: role,
      createdAt: nil,
      updatedAt: nil)
  }
  internal init(id: String = UUID().uuidString,
      houseId: String,
      userId: String? = nil,
      name: String,
      role: String,
      createdAt: Temporal.DateTime? = nil,
      updatedAt: Temporal.DateTime? = nil) {
      self.id = id
      self.houseId = houseId
      self.userId = userId
      self.name = name
      self.role = role
      self.createdAt = createdAt
      self.updatedAt = updatedAt
  }
}