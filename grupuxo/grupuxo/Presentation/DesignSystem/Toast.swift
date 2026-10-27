import SwiftUI

/// Aviso curto de que algo foi criado ou excluído, mostrado sobre as abas por alguns segundos.
/// Não pede ação nem bloqueia a tela; o VoiceOver anuncia o texto.
struct ToastMessage: Equatable, Identifiable {
    let id = UUID()
    let text: String
    let systemImage: String

    static func created(_ text: String) -> ToastMessage {
        ToastMessage(text: text, systemImage: "checkmark.circle.fill")
    }

    static func deleted(_ text: String) -> ToastMessage {
        ToastMessage(text: text, systemImage: "trash.fill")
    }
}

/// Ação de ambiente para mostrar um `ToastMessage`; sem `toastHost()` acima, não faz nada.
struct ShowToastAction {
    fileprivate let action: @MainActor (ToastMessage) -> Void

    @MainActor
    func callAsFunction(_ message: ToastMessage) {
        action(message)
    }
}

extension EnvironmentValues {
    @Entry var showToast = ShowToastAction { _ in }
}

private struct ToastHost: ViewModifier {

    @State private var message: ToastMessage?

    func body(content: Content) -> some View {
        content
            .environment(\.showToast, ShowToastAction { show($0) })
            .overlay(alignment: .bottom) {
                if let message {
                    Label(message.text, systemImage: message.systemImage)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(.regularMaterial, in: .capsule)
                        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 64)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .accessibilityHidden(true)
                        .id(message.id)
                        .onTapGesture { dismiss(message) }
                        .task(id: message.id) {
                            try? await Task.sleep(for: .seconds(2.5))
                            dismiss(message)
                        }
                }
            }
    }

    @MainActor
    private func show(_ newMessage: ToastMessage) {
        Haptics.success()
        AccessibilityNotification.Announcement(newMessage.text).post()
        withAnimation(.spring(duration: 0.35)) { message = newMessage }
    }

    @MainActor
    private func dismiss(_ shown: ToastMessage) {
        guard message?.id == shown.id else { return }
        withAnimation(.easeOut(duration: 0.25)) { message = nil }
    }
}

extension View {
    /// Coloca o aviso sobre esta view e entrega `showToast` às de dentro.
    func toastHost() -> some View {
        modifier(ToastHost())
    }
}
