//
//  PendingTasksBadge.swift
//  grupuxo
//

import UserNotifications

/// Número de tarefas pendentes no ícone do app (selo).
///
/// Não há interruptor no app: quem liga ou desliga é o iOS, em
/// Ajustes > Notificações > Reveza > Selos. Se estiver desligado, nada aparece.
/// O número só é recalculado com o app rodando (ao abrir, ao voltar e ao concluir tarefa).
@MainActor
enum PendingTasksBadge {

    private static var isRequestingPermission = false

    /// Chamar com a quantidade de tarefas pendentes sempre que a lista mudar.
    static func update(pending count: Int) {
        let value = max(0, count)
        Task {
            let center = UNUserNotificationCenter.current()

            // Primeira vez: o iOS pergunta uma única vez, então já pede tudo que o app usa.
            if await center.notificationSettings().authorizationStatus == .notDetermined,
               !isRequestingPermission {
                isRequestingPermission = true
                _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
                isRequestingPermission = false
            }

            // Sem permissão para selos, isto falha em silêncio.
            try? await center.setBadgeCount(value)
        }
    }

    /// No logout: o número é de uma pessoa específica.
    static func clear() {
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
    }
}
