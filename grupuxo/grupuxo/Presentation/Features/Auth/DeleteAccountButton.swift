import SwiftUI

/// "Excluir conta" com confirmação: o servidor apaga os dados e o usuário no Cognito (`DELETE /v1/me`; o `DeleteUser`
/// do app não funciona com o login da Apple) e o app só encerra a sessão local. Se o servidor falhar no meio, repetir
/// é seguro: cada passo dele é idempotente.
struct DeleteAccountButton: View {
    @EnvironmentObject private var houses: RemoteHouseSession
    @EnvironmentObject private var authService: AuthService

    @State private var confirming = false
    @State private var isDeleting = false
    @State private var errorMessage: String?

    var body: some View {
        Button("Excluir conta", systemImage: "trash", role: .destructive) { confirming = true }
            .disabled(isDeleting || houses.isLoading)
            .confirmationDialog("Excluir sua conta?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Excluir conta", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Seu perfil e o vínculo com o WhatsApp serão apagados e você sai da casa. Se for o último morador, a casa, os cômodos e as tarefas também serão excluídos. Não dá para desfazer.")
            }
            .alert("Não foi possível excluir a conta", isPresented: errorBinding) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    }

    private func delete() async {
        isDeleting = true
        defer { isDeleting = false }
        guard await houses.deleteAccountOnServer() else {
            errorMessage = houses.errorMessage ?? String(localized: "Tente de novo em instantes.")
            return
        }
        await authService.signOut()
    }
}
