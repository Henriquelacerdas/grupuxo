// TODO — Injetar o caso de uso de criação de cômodo no ViewModel do formulário
// quando esse fluxo existir; manter aqui o carregamento da gestão após salvar.
// Passar usuário e casa da sessão explicitamente para consultas autorizadas.
// Expor carregamento, vazio e erro; evitar chamadas diretas ao MockStore.

import Combine
import Foundation

@MainActor
final class HouseManagementViewModel: ObservableObject {
    @Published private(set) var state: HouseManagementState = .idle
    private let getHouseRooms: GetHouseRoomsUseCase
    private let houseID: House.ID

    init(getHouseRooms: GetHouseRoomsUseCase, houseID: House.ID) {
        self.getHouseRooms = getHouseRooms
        self.houseID = houseID
    }

    func load() async {
        state = .loading
        do {
            let rooms = try await getHouseRooms(houseID: houseID)
            state = rooms.isEmpty ? .empty : .content(rooms)
        } catch {
            state = .failure(error.localizedDescription)
        }
    }
}
