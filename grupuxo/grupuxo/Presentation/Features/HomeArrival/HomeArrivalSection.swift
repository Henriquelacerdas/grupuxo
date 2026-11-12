//
//  HomeArrivalSection.swift
//  grupuxo
//

import SwiftUI
import UIKit

/// Seção "Chegada em casa" dos ajustes da casa.
struct HomeArrivalSection: View {

    @ObservedObject private var monitor = HomeArrivalMonitor.shared
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            Toggle(
                "Mostrar minhas tarefas ao chegar em casa",
                isOn: Binding(
                    get: { monitor.isEnabled },
                    set: { newValue in Task { await monitor.setEnabled(newValue) } }
                )
            )

            Button {
                monitor.setHomeToCurrentLocation()
            } label: {
                Label(
                    monitor.hasHomeLocation
                        ? "Atualizar localização da casa"
                        : "Usar minha localização atual como casa",
                    systemImage: "location.fill"
                )
            }
            .disabled(monitor.isLocating)

            if monitor.hasHomeLocation {
                Label("Localização da casa definida neste aparelho", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            if monitor.needsAlwaysPermission {
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        "Para avisos com o app fechado, permita a localização “Sempre”.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .foregroundStyle(.orange)

                    Button("Abrir Ajustes") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    }
                }
            }

            if let message = monitor.message {
                Text(message).foregroundStyle(.red)
            }
        } header: {
            Text("Notificações em casa")
        } footer: {
            Text("Ao chegar em casa, o Reveza envia uma notificação com suas tarefas pendentes. A localização da casa fica só neste aparelho e não é enviada ao servidor. Vale uma distância de cerca de 150 m, e o aviso pode levar alguns minutos.")
        }
    }
}
