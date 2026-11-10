import StoreKit
import SwiftUI

/// Tela única do App Clip: apresenta o app e oferece baixar a versão completa.
struct ContentView: View {
    @State private var showsOverlay = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image("AppLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 96, height: 96)
                .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Reveza")
                    .font(.largeTitle.bold())
                Text("A casa em dia, sem discussão: o Reveza distribui as tarefas domésticas de forma justa entre os moradores.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Button {
                showsOverlay = true
            } label: {
                Text("Baixar o app completo")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(24)
        .appStoreOverlay(isPresented: $showsOverlay) {
            SKOverlay.AppClipConfiguration(position: .bottom)
        }
        .onAppear { showsOverlay = true }
    }
}

#Preview {
    ContentView()
}
