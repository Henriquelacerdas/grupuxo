// GUIA — Há uma etapa gulosa: maior esforço primeiro, menor carga e histórico
// como desempate. Ainda faltam integração com recorrência e busca local.
// TODO: o caso de uso deve fornecer apenas ocorrências periódicas disponíveis da
// semana e da política aplicável; excluir avulsas, futuras e moradores em férias.
// Montar elegíveis por RoomMembership, respeitando acesso e visibilidade da tarefa.
// Para balancear pessoas do mesmo cômodo, explicitar o escopo de currentLoads:
// o dicionário atual só possui usuário, não separa carga por cômodo. Preparar os
// dados por cômodo ou estender o contrato antes de misturar tarefas de vários cômodos.
// Após a etapa gulosa, tentar realocações/trocas que reduzam a diferença de esforço
// sem violar elegibilidade. Definir parada e desempates determinísticos em testes.
// Persistir decisões atomicamente e recalcular quando a elegibilidade mudar;
// o filtro atual ignora tarefas atribuídas e sozinho não faz essa redistribuição.

import Foundation

struct TaskDistributionDecision: Hashable, Sendable {
    let occurrenceID: TaskOccurrence.ID
    let userID: User.ID
}

struct TaskDistributionEngine: Sendable {
    func distribute(
        tasks: [TaskItem],
        eligibleUserIDsByRoom: [Room.ID: [User.ID]],
        currentLoads: [User.ID: WeeklyLoad],
        absentUserIDs: Set<User.ID>,
        previousAssigneeByTask: [TaskDefinition.ID: User.ID]
    ) -> [TaskDistributionDecision] {
        var projectedLoads = currentLoads.mapValues(\.points)
        var decisions: [TaskDistributionDecision] = []

        let orderedTasks = tasks
            .filter { item in
                let hasNoAssignment = item.assignment.map { _ in false } ?? true
                return !item.occurrence.isCompleted && hasNoAssignment
            }
            .sorted { $0.occurrence.effortSnapshot.points > $1.occurrence.effortSnapshot.points }

        for task in orderedTasks {
            let candidates = (eligibleUserIDsByRoom[task.definition.roomID] ?? [])
                .filter { !absentUserIDs.contains($0) }
            guard let selectedUserID = candidates.min(by: { lhs, rhs in
                let lhsKey = candidateKey(
                    userID: lhs,
                    load: projectedLoads[lhs, default: 0],
                    previousUserID: previousAssigneeByTask[task.definition.id]
                )
                let rhsKey = candidateKey(
                    userID: rhs,
                    load: projectedLoads[rhs, default: 0],
                    previousUserID: previousAssigneeByTask[task.definition.id]
                )
                return lhsKey < rhsKey
            }) else { continue }

            decisions.append(TaskDistributionDecision(occurrenceID: task.id, userID: selectedUserID))
            projectedLoads[selectedUserID, default: 0] += task.occurrence.effortSnapshot.points
        }

        return decisions
    }

    private func candidateKey(userID: User.ID, load: Int, previousUserID: User.ID?) -> String {
        let repetitionPenalty = userID == previousUserID ? 1 : 0
        return String(format: "%08d-%d-%@", load, repetitionPenalty, userID.uuidString)
    }
}
