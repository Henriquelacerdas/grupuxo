// swiftlint:disable all
import Amplify
import Foundation

// Contains the set of classes that conforms to the `Model` protocol. 

final public class AmplifyModels: AmplifyModelRegistration {
  public let version: String = "eb8da8789d439ef0ea3795a2465bc875"
  
  public func registerModels(registry: ModelRegistry.Type) {
    ModelRegistry.register(modelType: HouseRecord.self)
    ModelRegistry.register(modelType: RoomRecord.self)
    ModelRegistry.register(modelType: MemberRecord.self)
  }
}