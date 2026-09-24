import Combine
import Foundation

@MainActor
final class HouseManagementViewModel: ObservableObject {

    @Published private(set) var state: HouseManagementState = .idle

    private let getHouseRooms: GetHouseRoomsUseCase

    private let houseID: House.ID
    private let userID: User.ID

    init(
        getHouseRooms: GetHouseRoomsUseCase,
        houseID: House.ID,
        userID: User.ID
    ) {
        self.getHouseRooms = getHouseRooms
        self.houseID = houseID
        self.userID = userID
    }

    func load() async {

        state = .loading

        do {

            let rooms = try await getHouseRooms(
                houseID: houseID,
                userID: userID
            )

            state = rooms.isEmpty
                ? .empty
                : .content(rooms)

        } catch {

            state = .failure(
                error.localizedDescription
            )
        }
    }
}
