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

    /// Chamar com a quantidade de tarefas pendentes sempre que a lista mudar.
    static func update(pending count: Int) {
        let value = max(0, count)
        Task {
            // A permissão é pedida no onboarding ou em Ajustes › Notificações, nunca ao abrir a lista.
            // Sem permissão para selos, isto falha em silêncio.
            try? await UNUserNotificationCenter.current().setBadgeCount(value)
        }
    }

    /// No logout: o número é de uma pessoa específica.
    static func clear() {
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
    }
}
