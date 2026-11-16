import SwiftUI

/// WhatsApp: conectar e desconectar o número (o fluxo e os textos são os de `WhatsAppConnectionSection`).
struct WhatsAppSettingsView: View {

    @ObservedObject var viewModel: WhatsAppConnectionViewModel

    var body: some View {

        List {
            WhatsAppConnectionSection(viewModel: viewModel)
        }
        .navigationTitle("WhatsApp")
        .navigationBarTitleDisplayMode(.inline)
    }
}
