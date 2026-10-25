import UIKit

/// Hápticos pelos geradores do UIKit, chamados direto na ação da tela.
/// O `.sensoryFeedback` do SwiftUI não vibrou no aparelho nessas telas.
@MainActor
enum Haptics {

    /// Toque em concluir/desmarcar: vibra na hora, antes da resposta da api.
    /// Vale para todas as telas que concluem tarefa (Minhas tarefas, cômodo, avulsas).
    static func completionToggled(wasCompleted: Bool) {
        if wasCompleted {
            lightImpact()
        } else {
            success()
        }
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    static func lightImpact() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
