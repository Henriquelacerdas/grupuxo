// swiftlint:disable all
import Amplify
import Foundation

public struct InviteCode: Model {
  public let id: String
  public var houseId: String
  public var members: [String]
  public var createdAt: Temporal.DateTime?
  public var updatedAt: Temporal.DateTime?
  
  public init(id: String = UUID().uuidString,
      houseId: String,
      members: [String]) {
    self.init(id: id,
      houseId: houseId,
      members: members,
      createdAt: nil,
      updatedAt: nil)
  }
  internal init(id: String = UUID().uuidString,
      houseId: String,
      members: [String],
      createdAt: Temporal.DateTime? = nil,
      updatedAt: Temporal.DateTime? = nil) {
      self.id = id
      self.houseId = houseId
      self.members = members
      self.createdAt = createdAt
      self.updatedAt = updatedAt
  }
}