import Combine
import Foundation

/// Preferências de push em Ajustes › Notificações (`GET`/`PUT /v1/me/notification-preferences`). Cada mudança grava na
/// hora; se o servidor recusar, o interruptor volta ao que ele tem.
@MainActor
final class PushPreferencesViewModel: ObservableObject {

    @Published private(set) var preferences: NotificationPreferencesDTO?
    @Published private(set) var isSaving = false
    @Published var errorMessage: String?

    private let api: APIClient?

    init(api: APIClient?) {
        self.api = api
    }

    func load() async {
        guard let api else { return }
        do {
            preferences = try await api.get(NotificationPreferencesDTO.self, "v1/me/notification-preferences")
        } catch is CancellationError {
        } catch {
            errorMessage = RemoteHouseSession.message(for: error)
        }
    }

    func update(_ change: (inout NotificationPreferencesDTO) -> Void) async {
        guard let api, var next = preferences, !isSaving else { return }
        change(&next)
        guard next != preferences else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            preferences = try await api.send("PUT", "v1/me/notification-preferences", body: next).decodedPreferences()
        } catch {
            errorMessage = RemoteHouseSession.message(for: error)
            await load()
        }
    }
}

private extension Data {
    func decodedPreferences() throws -> NotificationPreferencesDTO {
        try JSONDecoder().decode(NotificationPreferencesDTO.self, from: self)
    }
}
