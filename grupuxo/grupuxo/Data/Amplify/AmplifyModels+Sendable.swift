// Fica FORA da pasta Models para não ser apagado ao regenerar os models.
// Os models gerados são structs só com valores (String/Temporal), então é seguro
// marcá-los como Sendable para o Swift 6 deixar passá-los entre actors.
import Amplify

extension HouseRecord: @unchecked Sendable {}
extension RoomRecord: @unchecked Sendable {}
extension MemberRecord: @unchecked Sendable {}
