import SwiftUI
import UIKit

/// Notificações: avisos push por tipo, a situação da permissão do iPhone e o espelho das tarefas no app Lembretes.
/// Avisos diretos (pedido de troca, pedido de entrada) sempre chegam; o resto se liga e desliga aqui.
struct NotificationSettingsView: View {

    @EnvironmentObject private var push: PushRegistration
    @EnvironmentObject private var houses: RemoteHouseSession
    @Environment(\.openURL) private var openURL

    @StateObject private var preferences: PushPreferencesViewModel

    init(api: APIClient?) {
        _preferences = StateObject(wrappedValue: PushPreferencesViewModel(api: api))
    }

    var body: some View {

        List {

            permissionSection

            if let current = preferences.preferences {
                Section {
                    toggle("Quando o ciclo virar", isOn: current.cycleTurned) { $0.cycleTurned = $1 }
                    toggle("Atividade da casa", isOn: current.houseActivity) { $0.houseActivity = $1 }
                    toggle("Resumo da semana", isOn: current.weeklySummary) { $0.weeklySummary = $1 }
                } header: {
                    Text("Avisos")
                } footer: {
                    Text("Pedidos de troca e de entrada em cômodo sempre chegam.")
                }
                .disabled(preferences.isSaving)
            }

            RemindersSyncSection()
        }
        .navigationTitle("Notificações")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await push.refreshStatus()
            await preferences.load()
        }
        .alert(
            "Não foi possível atualizar",
            isPresented: Binding(get: { preferences.errorMessage != nil }, set: { if !$0 { preferences.errorMessage = nil } })
        ) {
            Button("OK") { preferences.errorMessage = nil }
        } message: {
            Text(preferences.errorMessage ?? "")
        }
    }

    @ViewBuilder
    private var permissionSection: some View {

        switch push.status {
        case .notDetermined:
            Section {
                Button("Ativar notificações") {
                    Task {
                        if await push.requestAuthorization() { await push.resendToken() }
                    }
                }
            } footer: {
                Text("O Reveza avisa quando algo muda na casa. Você escolhe quais avisos abaixo.")
            }
        case .denied:
            Section {
                Button("Abrir Ajustes do iPhone") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            } footer: {
                Text("As notificações do Reveza estão desligadas no iPhone.")
            }
        default:
            EmptyView()
        }
    }

    private func toggle(
        _ title: LocalizedStringKey, isOn: Bool, set: @escaping (inout NotificationPreferencesDTO, Bool) -> Void
    ) -> some View {
        Toggle(title, isOn: Binding(
            get: { isOn },
            set: { value in Task { await preferences.update { set(&$0, value) } } }
        ))
    }
}
