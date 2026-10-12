import Combine
import Foundation
import GrupuxoDomain

/// Dono do `AppContainer` (e do `MockStore` dentro dele) e da `AppSession` da casa aberta.
///
/// Fica num `@StateObject` do `RootView`: o SwiftUI cria o modelo uma vez por identidade da view e o
/// mantém quando a struct `RootView` é reconstruída (o `HouseGateView` reavalia o conteúdo a cada
/// `@Published` do `HouseService`). Por isso ações na casa não trocam o store.
@MainActor
final class RootModel: ObservableObject {

    let container: AppContainer
    let session: AppSession

    enum SyncState: Equatable {
        case syncing
        case synced
        case failed(String)
    }

    @Published private(set) var syncState: SyncState = .syncing

    var isSynced: Bool { syncState == .synced }

    init(
        container: AppContainer = AppContainer(store: MockStore(state: MockSeed.empty())),
        session: AppSession = AppSession(
            currentUser: User(id: UUID(), name: "", email: nil),
            currentHouse: House(id: UUID(), name: "", accessCode: "", createdAt: .now)
        )
    ) {
        self.container = container
        self.session = session
    }

    /// Reflete a casa real no store e só então atualiza a sessão (morador e casa reais).
    func apply(_ snapshot: HouseSnapshot, user: User, house: House) async throws {
        try await container.sync(snapshot)
        objectWillChange.send()
        session.currentUser = user
        session.currentHouse = house
        syncState = .synced
    }

    /// Converte a casa real e sincroniza. Falha fechado: id inválido ou erro do store deixam `.failed`
    /// (com "Tentar novamente") em vez de uma sessão com ids inventados. Já sincronizado, mantém as
    /// telas durante o novo sync (trocar por spinner reiniciaria a navegação).
    func sync(
        house: HouseRecord,
        members: [MemberRecord],
        rooms: [RoomRecord],
        inviteCode: String?,
        me: MemberRecord
    ) async {
        if case .failed = syncState { syncState = .syncing }
        do {
            let snapshot = try HouseSnapshot.make(
                house: house, members: members, rooms: rooms, inviteCode: inviteCode
            )
            try await apply(
                snapshot,
                user: User(id: try HouseSnapshot.residentID(me), name: me.name, email: nil),
                house: House(
                    id: snapshot.houseID, name: house.name,
                    accessCode: snapshot.inviteCode, createdAt: .now
                )
            )
        } catch {
            syncState = .failed(error.localizedDescription)
        }
    }
}
