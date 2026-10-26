//
//  RoomOtherTaskRows.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 25/10/26.
//

import SwiftUI
import GrupuxoDomain

/// Tarefa com periodicidade independente do ciclo do cômodo.
struct RoomGeneralTaskRow: View {
    let item: TaskItem
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.definition.name)
                        .font(.system(size: 17))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text("\(recurrenceLabel) · \(effortLabel)")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(height: 68)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var effortLabel: String {
        switch item.definition.effort.points {
        case 1: return "Leve"
        case 2: return "Médio"
        default: return "Intenso"
        }
    }

    private var recurrenceLabel: String {
        switch item.definition.recurrence {
        case .none: return "Sem repetição"
        case let .weekly(value): return value.label
        case let .recurring(frequency, interval):
            let unit: String
            switch frequency {
            case .daily: unit = interval == 1 ? "dia" : "dias"
            case .weekly: unit = interval == 1 ? "semana" : "semanas"
            case .monthly: unit = interval == 1 ? "mês" : "meses"
            case .yearly: unit = interval == 1 ? "ano" : "anos"
            }
            return "A cada \(interval) \(unit)"
        }
    }
}

/// Componente visual da tarefa única. `onClaim` deve ser conectado ao
/// ClaimSporadicTaskUseCase antes de habilitar a ação "Pegar".
struct RoomUniqueTaskRow: View {
    let item: TaskItem
    let onSelect: () -> Void
    var onClaim: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onSelect) {
                HStack(spacing: 8) {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 19))
                        .foregroundStyle(.red)
                        .frame(width: 40, height: 40)
                        .padding(.trailing, 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.definition.name)
                            .font(.system(size: 17))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Text(responsibleLabel)
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if item.assignment == nil && !item.occurrence.isCompleted {
                Button(action: { onClaim?() }) {
                    Text("Pegar")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color(uiColor: .systemBlue))
                        .padding(.horizontal, 16)
                        .frame(height: 34)
                        .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(onClaim == nil)
                .accessibilityHint(onClaim == nil ? "Ação ainda não conectada" : "Assumir esta tarefa")
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .frame(height: 68)
    }

    private var responsibleLabel: String {
        if let user = item.assignee { return "Para \(user.name)" }
        if item.occurrence.isCompleted { return "Concluída" }
        return "Ninguém pegou ainda"
    }
}

/// Apresentação de uma tarefa do ciclo no segmento "Todas":
/// definição da tarefa e nível de esforço, sem avatar do responsável atual.
struct RoomCycleAllTaskRow: View {
    let item: TaskItem
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.definition.name)
                        .font(.system(size: 17))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(effortLabel)
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(height: 68)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var effortLabel: String {
        switch item.definition.effort.points {
        case 1: return "Leve"
        case 2: return "Médio"
        default: return "Intenso"
        }
    }
}
