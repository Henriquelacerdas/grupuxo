// GUIA — Somar esforço da semana, não quantidade de tarefas; a soma pode passar de 3.
// TODO: usar calendário com início na segunda-feira e o mesmo fuso da rotação.
// Para equilíbrio dentro do cômodo, filtrar ocorrências e atribuições pelo cômodo
// antes de chamar este serviço (ele não recebe roomID nem definições).
// A soma atual percorre atribuições: devoluções/reassunções podem contar a mesma
// ocorrência mais de uma vez. Deduplicar e definir a contabilização de trocas com
// base no histórico; concluir tarefa já atribuída não deve somar esforço de novo.
// Usar effortSnapshot e testar fronteiras de semana, sem saldo de semanas anteriores.

import Foundation

struct WeeklyLoadCalculator: Sendable {
    func calculate(for userID: User.ID, assignments: [TaskAssignment], occurrences: [TaskOccurrence], referenceDate: Date, calendar: Calendar = .current) -> WeeklyLoad {
        guard let week = calendar.dateInterval(of: .weekOfYear, for: referenceDate) else { return WeeklyLoad(points: 0) }
        let occurrenceByID = Dictionary(uniqueKeysWithValues: occurrences.map { ($0.id, $0) })
        let points = assignments
            .filter {
                $0.userID == userID
                    && $0.assignedAt < week.end
                    && ($0.endedAt ?? .distantFuture) >= week.start
            }
            .compactMap { occurrenceByID[$0.occurrenceID]?.effortSnapshot.points }
            .reduce(0, +)
        return WeeklyLoad(points: points)
    }
}
