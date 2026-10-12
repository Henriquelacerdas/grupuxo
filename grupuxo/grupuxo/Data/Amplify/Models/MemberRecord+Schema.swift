// swiftlint:disable all
import Amplify
import Foundation

extension MemberRecord {
  // MARK: - CodingKeys 
   public enum CodingKeys: String, ModelKey {
    case id
    case houseId
    case userId
    case name
    case role
    case createdAt
    case updatedAt
  }
  
  public static let keys = CodingKeys.self
  //  MARK: - ModelSchema 
  
  public static let schema = defineSchema { model in
    let memberRecord = MemberRecord.keys
    
    model.authRules = [
      rule(allow: .private, operations: [.create, .update, .delete, .read])
    ]
    
    model.listPluralName = "MemberRecords"
    model.syncPluralName = "MemberRecords"
    
    model.attributes(
      .index(fields: ["houseId"], name: "memberRecordsByHouseId"),
      .index(fields: ["userId"], name: "memberRecordsByUserId"),
      .primaryKey(fields: [memberRecord.id])
    )
    
    model.fields(
      .field(memberRecord.id, is: .required, ofType: .string),
      .field(memberRecord.houseId, is: .required, ofType: .string),
      .field(memberRecord.userId, is: .optional, ofType: .string),
      .field(memberRecord.name, is: .required, ofType: .string),
      .field(memberRecord.role, is: .required, ofType: .string),
      .field(memberRecord.createdAt, is: .optional, isReadOnly: true, ofType: .dateTime),
      .field(memberRecord.updatedAt, is: .optional, isReadOnly: true, ofType: .dateTime)
    )
    }
    public class Path: ModelPath<MemberRecord> { }
    
    public static var rootPath: PropertyContainerPath? { Path() }
}

extension MemberRecord: ModelIdentifiable {
  public typealias IdentifierFormat = ModelIdentifierFormat.Default
  public typealias IdentifierProtocol = DefaultModelIdentifier<Self>
}
extension ModelPath where ModelType == MemberRecord {
  public var id: FieldPath<String>   {
      string("id") 
    }
  public var houseId: FieldPath<String>   {
      string("houseId") 
    }
  public var userId: FieldPath<String>   {
      string("userId") 
    }
  public var name: FieldPath<String>   {
      string("name") 
    }
  public var role: FieldPath<String>   {
      string("role") 
    }
  public var createdAt: FieldPath<Temporal.DateTime>   {
      datetime("createdAt") 
    }
  public var updatedAt: FieldPath<Temporal.DateTime>   {
      datetime("updatedAt") 
    }
}