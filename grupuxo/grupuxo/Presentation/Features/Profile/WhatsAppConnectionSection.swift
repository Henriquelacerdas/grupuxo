import GrupuxoDomain
import SwiftUI

/// Seção "WhatsApp" do Perfil. O botão abre o link `wa.me` com a mensagem pré-preenchida; enviar essa mensagem
/// é o aceite do morador (consentimento registrado no vínculo, BACKEND.md seção 8).
struct WhatsAppConnectionSection: View {
    @ObservedObject var viewModel: WhatsAppConnectionViewModel
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingDisconnect = false

    var body: some View {
        Section {
            content
            if let message = viewModel.actionError {
                Text(message).foregroundStyle(.red)
            }
        } header: {
            Text("WhatsApp")
        } footer: {
            Text("No WhatsApp, o Reveza te responde quais são suas tarefas e marca como feitas. Ele só responde quando você escreve.")
        }
        .task { await viewModel.load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await viewModel.load() } }
        }
        .alert("Desconectar o WhatsApp?", isPresented: $confirmingDisconnect) {
            Button("Desconectar", role: .destructive) {
                Task { await viewModel.disconnectNumber() }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Você pode conectar de novo quando quiser.")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Carregando…")
        case .notConnected:
            Button {
                Task {
                    if let url = await viewModel.connect() { openURL(url) }
                }
            } label: {
                Label("Conectar WhatsApp", systemImage: "message.fill")
            }
            .disabled(viewModel.isWorking)
        case .connected(let connection):
            VStack(alignment: .leading, spacing: 4) {
                Label("WhatsApp conectado", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text(connection.maskedPhone)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Button("Desconectar", role: .destructive) { confirmingDisconnect = true }
                .disabled(viewModel.isWorking)
        case .failed(let message):
            Text(message)
            Button("Tentar novamente") { Task { await viewModel.load() } }
        }
    }
}
