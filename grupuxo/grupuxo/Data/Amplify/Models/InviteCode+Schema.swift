// swiftlint:disable all
import Amplify
import Foundation

extension InviteCode {
  // MARK: - CodingKeys 
   public enum CodingKeys: String, ModelKey {
    case id
    case houseId
    case members
    case createdAt
    case updatedAt
  }
  
  public static let keys = CodingKeys.self
  //  MARK: - ModelSchema 
  
  public static let schema = defineSchema { model in
    let inviteCode = InviteCode.keys
    
    model.authRules = [
      rule(allow: .owner, ownerField: "members", identityClaim: "sub", provider: .userPools, operations: [.create, .update, .delete, .read])
    ]
    
    model.listPluralName = "InviteCodes"
    model.syncPluralName = "InviteCodes"
    
    model.attributes(
      .index(fields: ["houseId"], name: "inviteCodesByHouseId"),
      .primaryKey(fields: [inviteCode.id])
    )
    
    model.fields(
      .field(inviteCode.id, is: .required, ofType: .string),
      .field(inviteCode.houseId, is: .required, ofType: .string),
      .field(inviteCode.members, is: .required, ofType: .embeddedCollection(of: String.self)),
      .field(inviteCode.createdAt, is: .optional, isReadOnly: true, ofType: .dateTime),
      .field(inviteCode.updatedAt, is: .optional, isReadOnly: true, ofType: .dateTime)
    )
    }
    public class Path: ModelPath<InviteCode> { }
    
    public static var rootPath: PropertyContainerPath? { Path() }
}

extension InviteCode: ModelIdentifiable {
  public typealias IdentifierFormat = ModelIdentifierFormat.Default
  public typealias IdentifierProtocol = DefaultModelIdentifier<Self>
}
extension ModelPath where ModelType == InviteCode {
  public var id: FieldPath<String>   {
      string("id") 
    }
  public var houseId: FieldPath<String>   {
      string("houseId") 
    }
  public var members: FieldPath<String>   {
      string("members") 
    }
  public var createdAt: FieldPath<Temporal.DateTime>   {
      datetime("createdAt") 
    }
  public var updatedAt: FieldPath<Temporal.DateTime>   {
      datetime("updatedAt") 
    }
}