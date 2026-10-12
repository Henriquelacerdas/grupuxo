// swiftlint:disable all
import Amplify
import Foundation

extension HouseRecord {
  // MARK: - CodingKeys 
   public enum CodingKeys: String, ModelKey {
    case id
    case name
    case inviteCode
    case ownerId
    case createdAt
    case updatedAt
  }
  
  public static let keys = CodingKeys.self
  //  MARK: - ModelSchema 
  
  public static let schema = defineSchema { model in
    let houseRecord = HouseRecord.keys
    
    model.authRules = [
      rule(allow: .private, operations: [.create, .update, .delete, .read])
    ]
    
    model.listPluralName = "HouseRecords"
    model.syncPluralName = "HouseRecords"
    
    model.attributes(
      .index(fields: ["inviteCode"], name: "houseRecordsByInviteCode"),
      .primaryKey(fields: [houseRecord.id])
    )
    
    model.fields(
      .field(houseRecord.id, is: .required, ofType: .string),
      .field(houseRecord.name, is: .required, ofType: .string),
      .field(houseRecord.inviteCode, is: .required, ofType: .string),
      .field(houseRecord.ownerId, is: .required, ofType: .string),
      .field(houseRecord.createdAt, is: .optional, isReadOnly: true, ofType: .dateTime),
      .field(houseRecord.updatedAt, is: .optional, isReadOnly: true, ofType: .dateTime)
    )
    }
    public class Path: ModelPath<HouseRecord> { }
    
    public static var rootPath: PropertyContainerPath? { Path() }
}

extension HouseRecord: ModelIdentifiable {
  public typealias IdentifierFormat = ModelIdentifierFormat.Default
  public typealias IdentifierProtocol = DefaultModelIdentifier<Self>
}
extension ModelPath where ModelType == HouseRecord {
  public var id: FieldPath<String>   {
      string("id") 
    }
  public var name: FieldPath<String>   {
      string("name") 
    }
  public var inviteCode: FieldPath<String>   {
      string("inviteCode") 
    }
  public var ownerId: FieldPath<String>   {
      string("ownerId") 
    }
  public var createdAt: FieldPath<Temporal.DateTime>   {
      datetime("createdAt") 
    }
  public var updatedAt: FieldPath<Temporal.DateTime>   {
      datetime("updatedAt") 
    }
}