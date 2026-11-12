//
//  DailyTasksNoticeSection.swift
//  grupuxo
//
//  Created by Erika Hacimoto on 11/11/26.
//


//
//  DailyTasksNoticeSection.swift
//  grupuxo
//

import SwiftUI

/// Seção "Resumo diário" dos ajustes da casa.
struct DailyTasksNoticeSection: View {

    @ObservedObject private var manager = DailyTasksNoticeManager.shared

    var body: some View {
        Section {
            Toggle(
                "Resumo diário das minhas tarefas",
                isOn: Binding(
                    get: { manager.isEnabled },
                    set: { newValue in Task { await manager.setEnabled(newValue) } }
                )
            )

            if manager.isEnabled {
                DatePicker(
                    "Horário do resumo",
                    selection: Binding(get: { manager.time }, set: { manager.setTime($0) }),
                    displayedComponents: .hourAndMinute
                )
            }

            if let message = manager.message {
                Text(message).foregroundStyle(.red)
            }
        } header: {
            Text("Resumo diário")
        } footer: {
            Text("Todo dia, no horário escolhido, o Reveza lista as suas tarefas pendentes. O aviso é urgente e pode aparecer mesmo com um Foco ligado, se você permitir avisos urgentes do Reveza em Ajustes. A lista se atualiza quando você abre o app.")
        }
        .onAppear { manager.refresh() }
    }
}
