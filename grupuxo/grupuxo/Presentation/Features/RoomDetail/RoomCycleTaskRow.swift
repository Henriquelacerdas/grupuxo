//
//  RoomCycleTaskRow.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 25/10/26.
//


import SwiftUI
import GrupuxoDomain

/// Linha exclusiva da tela de cômodo. Não altera o TaskRow compartilhado.
struct RoomCycleTaskRow: View {
    let item: TaskItem
    let onSelect: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onSelect) {
                HStack(spacing: 8) {
                avatar
                    .frame(width: 40, height: 40)
                    .padding(.trailing, 8)

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.definition.name)
                        .font(.system(size: 17))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Text(responsibleText)
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 68)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Abre os detalhes da tarefa")

            Rectangle()
                .fill(Color(uiColor: .separator).opacity(0.45))
                .frame(height: 1)
                .frame(height: 8)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var avatar: some View {
        if let user = item.assignee ?? item.suggestedAssignee {
            Text(initials(user.name))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.tint)
                .frame(width: 40, height: 40)
                .background(.tint.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
        } else {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
                .frame(width: 40, height: 40)
                .accessibilityHidden(true)
        }
    }

    private var responsibleText: String {
        if let user = item.assignee {
            return "Para \(user.name)"
        }
        if let user = item.suggestedAssignee {
            return "Sugestão: \(user.name)"
        }
        return "Sem responsável"
    }

    private func initials(_ name: String) -> String {
        name.split(separator: " ")
            .prefix(2)
            .compactMap(\.first)
            .map(String.init)
            .joined()
    }
}
