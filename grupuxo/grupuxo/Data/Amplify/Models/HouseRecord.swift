// swiftlint:disable all
import Amplify
import Foundation

public struct HouseRecord: Model {
  public let id: String
  public var name: String
  public var inviteCode: String
  public var ownerId: String
  public var createdAt: Temporal.DateTime?
  public var updatedAt: Temporal.DateTime?
  
  public init(id: String = UUID().uuidString,
      name: String,
      inviteCode: String,
      ownerId: String) {
    self.init(id: id,
      name: name,
      inviteCode: inviteCode,
      ownerId: ownerId,
      createdAt: nil,
      updatedAt: nil)
  }
  internal init(id: String = UUID().uuidString,
      name: String,
      inviteCode: String,
      ownerId: String,
      createdAt: Temporal.DateTime? = nil,
      updatedAt: Temporal.DateTime? = nil) {
      self.id = id
      self.name = name
      self.inviteCode = inviteCode
      self.ownerId = ownerId
      self.createdAt = createdAt
      self.updatedAt = updatedAt
  }
}