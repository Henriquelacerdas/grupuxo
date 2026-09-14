enum HouseManagementState: Equatable {
    case idle
    case loading
    case content([Room])
    case empty
    case failure(String)
}
