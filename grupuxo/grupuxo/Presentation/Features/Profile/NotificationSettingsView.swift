import SwiftUI

/// Notificações: hoje só o espelho das tarefas do morador no app Lembretes. Os avisos do WhatsApp ficam na linha
/// própria de Ajustes; preferências por tipo de aviso dependem de rota no servidor.
struct NotificationSettingsView: View {

    var body: some View {

        List {
            RemindersSyncSection()
        }
        .navigationTitle("Notificações")
        .navigationBarTitleDisplayMode(.inline)
    }
}
