import Combine
import Foundation
import UIKit
import UserNotifications

/// Registro do aparelho para notificações push (APNs). O servidor manda só dados e o texto vem das chaves
/// `push.<tipo>` do app. Pela HIG, a permissão só é pedida num momento com motivo (passo "Ativar notificações" do
/// onboarding ou Ajustes › Notificações), nunca na abertura.
@MainActor
final class PushRegistration: ObservableObject {

    @Published private(set) var status: UNAuthorizationStatus = .notDetermined

    /// Manda o token ao servidor (`PUT /v1/me/devices`); definido quando a casa abre. Devolve `true` se registrou.
    var sendToken: ((String, String) async -> Bool)?

    private var token: String?
    private let center: UNUserNotificationCenter

    /// APNs de teste (build do Xcode) ou de produção (TestFlight e App Store).
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    func refreshStatus() async {
        status = await center.notificationSettings().authorizationStatus
    }

    var isAuthorized: Bool {
        status == .authorized || status == .provisional || status == .ephemeral
    }

    /// Pede a permissão (uma vez) e, concedida, registra o aparelho. `true` = notificações ligadas.
    @discardableResult
    func requestAuthorization() async -> Bool {
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshStatus()
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        return granted
    }

    /// Chamar quando a casa abre: quem já autorizou renova o token (ele pode mudar) e o servidor o recebe.
    func resumeIfAuthorized() async {
        await refreshStatus()
        if isAuthorized { UIApplication.shared.registerForRemoteNotifications() }
    }

    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        Task { _ = await sendToken?(hex, Self.environment) }
    }

    /// Reenvia o token que já chegou (a casa pode abrir depois dele).
    func resendToken() async {
        guard let token else { return }
        _ = await sendToken?(token, Self.environment)
    }
}

/// Recebe o token do APNs, que só chega pelo delegate do `UIApplication`.
final class PushAppDelegate: NSObject, UIApplicationDelegate {

    @MainActor weak var registration: PushRegistration?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in registration?.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Sem push (simulador sem conta, perfil sem a capacidade): o app segue normal.
    }
}
