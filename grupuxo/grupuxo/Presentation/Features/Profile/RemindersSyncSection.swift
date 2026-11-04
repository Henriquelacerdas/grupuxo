import SwiftUI

/// Seção "Lembretes" do Perfil: opt-in para espelhar no app Lembretes as tarefas que são suas
/// (nunca as dos outros moradores). Ligar pede a permissão do iOS; desligar apaga os lembretes criados pelo Reveza.
struct RemindersSyncSection: View {
    @State private var isEnabled = ReminderSyncPreference().isEnabled
    @State private var isWorking = false
    @State private var accessDenied = false

    private let cleaner = ReminderLinkCleaner()

    var body: some View {
        Section {
            Toggle("Sincronizar com o Lembretes", isOn: binding)
                .disabled(isWorking)
            if accessDenied {
                Text("Sem acesso ao Lembretes. Permita em Ajustes > Privacidade e Segurança > Lembretes.")
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Lembretes")
        } footer: {
            Text("Cria no app Lembretes um lembrete para cada tarefa sua e mantém os dois em sincronia. Tarefas de outros moradores não aparecem. Ao desligar, os lembretes criados pelo Reveza são apagados.")
        }
    }

    private var binding: Binding<Bool> {
        Binding(
            get: { isEnabled },
            set: { newValue in
                isEnabled = newValue
                Task { await apply(newValue) }
            }
        )
    }

    private func apply(_ enabled: Bool) async {
        isWorking = true
        defer { isWorking = false }
        accessDenied = false

        if enabled {
            guard await cleaner.requestAccess() else {
                isEnabled = false
                accessDenied = true
                return
            }
            ReminderSyncPreference().setEnabled(true)
            NotificationCenter.default.post(name: .reminderSyncDidEnable, object: nil)
        } else {
            ReminderSyncPreference().setEnabled(false)
            await cleaner.removeAll()
        }
    }
}
