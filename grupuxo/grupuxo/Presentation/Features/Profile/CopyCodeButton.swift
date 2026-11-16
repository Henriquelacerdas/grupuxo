import SwiftUI

/// "Copiar" do código de convite: copia para a área de transferência e confirma por um instante.
struct CopyCodeButton: View {

    let code: String

    @State private var copied = false

    var body: some View {

        Button {
            UIPasteboard.general.string = code
            Haptics.success()
            copied = true
        } label: {
            Text(copied ? "Copiado" : "Copiar")
                .font(.subheadline)
                .padding(.horizontal, DesignSystem.Spacing.medium)
                .padding(.vertical, DesignSystem.Spacing.small)
                .background(
                    Color.accentColor.opacity(DesignSystem.tintedFillOpacity),
                    in: Capsule()
                )
                // A cápsula abraça o texto; a área de toque chega ao mínimo do HIG.
                .frame(minHeight: DesignSystem.minimumTouchTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Copiar código")
        // Ao sumir a tela a tarefa é cancelada; copiar de novo reinicia a contagem.
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: DesignSystem.copyFeedbackDuration)
            copied = false
        }
    }
}
