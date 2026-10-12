// swiftlint:disable all
import Amplify
import Foundation

extension RoomRecord {
  // MARK: - CodingKeys 
   public enum CodingKeys: String, ModelKey {
    case id
    case houseId
    case name
    case createdAt
    case updatedAt
  }
  
  public static let keys = CodingKeys.self
  //  MARK: - ModelSchema 
  
  public static let schema = defineSchema { model in
    let roomRecord = RoomRecord.keys
    
    model.authRules = [
      rule(allow: .private, operations: [.create, .update, .delete, .read])
    ]
    
    model.listPluralName = "RoomRecords"
    model.syncPluralName = "RoomRecords"
    
    model.attributes(
      .index(fields: ["houseId"], name: "roomRecordsByHouseId"),
      .primaryKey(fields: [roomRecord.id])
    )
    
    model.fields(
      .field(roomRecord.id, is: .required, ofType: .string),
      .field(roomRecord.houseId, is: .required, ofType: .string),
      .field(roomRecord.name, is: .required, ofType: .string),
      .field(roomRecord.createdAt, is: .optional, isReadOnly: true, ofType: .dateTime),
      .field(roomRecord.updatedAt, is: .optional, isReadOnly: true, ofType: .dateTime)
    )
    }
    public class Path: ModelPath<RoomRecord> { }
    
    public static var rootPath: PropertyContainerPath? { Path() }
}

extension RoomRecord: ModelIdentifiable {
  public typealias IdentifierFormat = ModelIdentifierFormat.Default
  public typealias IdentifierProtocol = DefaultModelIdentifier<Self>
}
extension ModelPath where ModelType == RoomRecord {
  public var id: FieldPath<String>   {
      string("id") 
    }
  public var houseId: FieldPath<String>   {
      string("houseId") 
    }
  public var name: FieldPath<String>   {
      string("name") 
    }
  public var createdAt: FieldPath<Temporal.DateTime>   {
      datetime("createdAt") 
    }
  public var updatedAt: FieldPath<Temporal.DateTime>   {
      datetime("updatedAt") 
    }
}