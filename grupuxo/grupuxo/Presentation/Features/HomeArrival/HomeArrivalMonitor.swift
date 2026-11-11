//
//  HomeArrivalMonitor.swift
//  grupuxo
//

import CoreLocation
import Foundation
import GrupuxoDomain
import UIKit
import UserNotifications
import Combine

/// Avisa as tarefas pendentes quando a pessoa chega em casa.
///
/// A localização da casa fica só neste aparelho (UserDefaults). O iOS monitora a região
/// e acorda o app em segundo plano na chegada, mesmo com ele fechado.
@MainActor
final class HomeArrivalMonitor: NSObject, ObservableObject {

    static let shared = HomeArrivalMonitor()

    @Published private(set) var isEnabled: Bool
    @Published private(set) var hasHomeLocation: Bool
    @Published private(set) var authorization: CLAuthorizationStatus
    @Published private(set) var isLocating = false
    @Published private(set) var message: String?

    nonisolated private static let regionID = "grupuxo.home"
    nonisolated private static let notificationID = "grupuxo.arrival"
    private static let notificationDelegate = ArrivalNotificationDelegate()

    private enum Key {
        static let enabled = "homeArrival.enabled"
        static let latitude = "homeArrival.latitude"
        static let longitude = "homeArrival.longitude"
        static let lastNotified = "homeArrival.lastNotified"
    }

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard

    /// Raio em volta da casa. Abaixo de ~100 m o iOS não é confiável.
    private let radius: CLLocationDistance = 150
    /// Intervalo mínimo entre avisos, para não repetir se o sinal oscilar na borda.
    private let minimumInterval: TimeInterval = 6 * 60 * 60

    private var wantsLocationForHome = false
    private var upgradeToAlwaysWhenPossible = false

    private override init() {
        let defaults = UserDefaults.standard
        isEnabled = defaults.bool(forKey: Key.enabled)
        hasHomeLocation = defaults.object(forKey: Key.latitude) != nil
        authorization = CLLocationManager().authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        UNUserNotificationCenter.current().delegate = Self.notificationDelegate
    }

    // MARK: - Estado para a tela

    /// Com o app fechado só funciona com a permissão "Sempre".
    var needsAlwaysPermission: Bool {
        isEnabled && authorization != .authorizedAlways && authorization != .notDetermined
    }

    // MARK: - Ações

    /// Chamar no lançamento do app: recria o monitoramento e garante o delegate ativo.
    func start() {
        applyMonitoring()
    }

    func setEnabled(_ enabled: Bool) async {
        message = nil

        guard enabled else {
            defaults.set(false, forKey: Key.enabled)
            isEnabled = false
            applyMonitoring()
            return
        }

        guard hasHomeLocation else {
            message = String(localized: "Defina primeiro a localização da casa.")
            return
        }

        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else {
            message = String(localized: "Ative as notificações do Reveza em Ajustes para receber os avisos.")
            return
        }

        defaults.set(true, forKey: Key.enabled)
        isEnabled = true
        requestLocationAuthorization()
        applyMonitoring()
    }

    func setHomeToCurrentLocation() {
        message = nil

        switch manager.authorizationStatus {
        case .notDetermined:
            wantsLocationForHome = true
            isLocating = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            message = String(localized: "Permita o acesso à localização em Ajustes para definir a casa.")
        default:
            isLocating = true
            manager.requestLocation()
        }
    }

    // MARK: - Monitoramento

    private func requestLocationAuthorization() {
        switch manager.authorizationStatus {
        case .notDetermined:
            upgradeToAlwaysWhenPossible = true
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            manager.requestAlwaysAuthorization()
        default:
            break
        }
    }

    private func applyMonitoring() {
        for region in manager.monitoredRegions where region.identifier == Self.regionID {
            manager.stopMonitoring(for: region)
        }

        guard isEnabled, hasHomeLocation,
              CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        else { return }

        let center = CLLocationCoordinate2D(
            latitude: defaults.double(forKey: Key.latitude),
            longitude: defaults.double(forKey: Key.longitude)
        )
        let region = CLCircularRegion(
            center: center,
            radius: min(radius, manager.maximumRegionMonitoringDistance),
            identifier: Self.regionID
        )
        region.notifyOnEntry = true
        region.notifyOnExit = false
        manager.startMonitoring(for: region)
    }

    // MARK: - Chegada

    fileprivate func handleArrival() async {
        guard isEnabled else { return }

        if let last = defaults.object(forKey: Key.lastNotified) as? Date,
           Date().timeIntervalSince(last) < minimumInterval {
            return
        }

        // Dá tempo ao app, em segundo plano, de buscar as tarefas antes de ser suspenso.
        let background = UIApplication.shared.beginBackgroundTask(
            withName: "grupuxo.arrival",
            expirationHandler: nil
        )
        defer { UIApplication.shared.endBackgroundTask(background) }

        guard let content = await makeNotificationContent() else { return }

        let request = UNNotificationRequest(
            identifier: Self.notificationID,
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
        defaults.set(Date(), forKey: Key.lastNotified)
    }

    /// `nil` quando não há nada a avisar (sem tarefas pendentes ou sem login).
    private func makeNotificationContent() async -> UNNotificationContent? {
        let content = UNMutableNotificationContent()
        content.sound = .default

        do {
            let context = try await ShortcutBackend.context(refresh: true)
            let tasks = try await GetMyTasksUseCase(
                repository: context.container.taskRepository
            )(
                userID: context.session.currentUser.id,
                houseID: context.session.currentHouse.id
            )

            let pending = tasks.filter { !$0.occurrence.isCompleted }
            guard !pending.isEmpty else { return nil }

            content.title = pending.count == 1
                ? String(localized: "Você tem 1 tarefa pendente")
                : String(localized: "Você tem \(pending.count) tarefas pendentes")

            let maximumNames = 5
            var lines = pending.prefix(maximumNames).map { "• \($0.definition.name)" }
            if pending.count > maximumNames {
                lines.append(String(localized: "e mais \(pending.count - maximumNames)"))
            }
            content.body = lines.joined(separator: "\n")
            return content

        } catch ShortcutError.notSignedIn, ShortcutError.noHouse {
            return nil
        } catch {
            // Sem rede ou erro do servidor: avisa mesmo assim, sem a lista.
            content.title = String(localized: "Você chegou em casa")
            content.body = String(localized: "Toque para ver suas tarefas.")
            return content
        }
    }

    // MARK: - Eventos do CoreLocation (chegam fora do MainActor)

    fileprivate func authorizationChanged(_ status: CLAuthorizationStatus) {
        authorization = status

        if wantsLocationForHome,
           status == .authorizedWhenInUse || status == .authorizedAlways {
            wantsLocationForHome = false
            manager.requestLocation()
        } else if wantsLocationForHome, status == .denied || status == .restricted {
            wantsLocationForHome = false
            isLocating = false
            message = String(localized: "Permita o acesso à localização em Ajustes para definir a casa.")
        }

        if upgradeToAlwaysWhenPossible, status == .authorizedWhenInUse {
            upgradeToAlwaysWhenPossible = false
            manager.requestAlwaysAuthorization()
        }

        applyMonitoring()
    }

    fileprivate func receivedHomeLocation(latitude: Double, longitude: Double, accuracy: Double) {
        isLocating = false

        guard accuracy >= 0, accuracy <= 150 else {
            message = String(localized: "A localização está imprecisa. Tente de novo, de preferência ao ar livre.")
            return
        }

        defaults.set(latitude, forKey: Key.latitude)
        defaults.set(longitude, forKey: Key.longitude)
        hasHomeLocation = true
        applyMonitoring()
    }

    fileprivate func locationFailed(_ text: String) {
        isLocating = false
        message = text
    }
}

// MARK: - CLLocationManagerDelegate

extension HomeArrivalMonitor: CLLocationManagerDelegate {

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.authorizationChanged(status) }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let location = locations.last else { return }
        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let accuracy = location.horizontalAccuracy
        Task { @MainActor in
            self.receivedHomeLocation(latitude: latitude, longitude: longitude, accuracy: accuracy)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let text = error.localizedDescription
        Task { @MainActor in self.locationFailed(text) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier == Self.regionID else { return }
        Task { @MainActor in await self.handleArrival() }
    }
}

// MARK: - Notificações

/// Mostra o aviso mesmo com o app aberto e leva para "Minhas tarefas" ao tocar.
///
/// Usa as versões com `completionHandler`, as mais confiáveis para o toque que
/// abre o app a frio (app fechado).
final class ArrivalNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let id = response.notification.request.identifier
        if id == "grupuxo.arrival" || id.hasPrefix("grupuxo.cycle.") {
//        if response.notification.request.identifier == "grupuxo.arrival" {
            // Se o app abriu a frio, o RootView lê este destino assim que aparecer.
            Task { @MainActor in
                ShortcutNavigationManager.shared.navigate(to: .myTasks)
            }
        }
        completionHandler()
    }
}
