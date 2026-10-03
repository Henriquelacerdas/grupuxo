import Foundation
import GrupuxoDomain

private let weekly1 = RecurrencePolicy.recurring(frequency: .weekly, interval: 1)

private func absence(_ n: Int, user: Int, from: Date, to: Date) -> Absence {
    try! Absence(id: uid(500 + n), membershipID: uid(300 + user), startsAt: from, endsAt: to, reason: nil)
}

// MARK: Criação

func createScenarios() -> [Scenario] {
    var list: [Scenario] = []
    list.append(Scenario(name: "semanal independente, refresh depois de 5 semanas e criação repetida", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: wed),
        .create(task(2, room: W.bathroom, effort: 2), at: wed),
        .refresh(at: days(35)),
        .refresh(at: days(35)),
        .create(task(1, room: W.kitchen, effort: 3), at: days(35)),
    ]))
    list.append(Scenario(name: "intervalos semanais 2 e 20", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, recurrence: .recurring(frequency: .weekly, interval: 2)), at: wed),
        .create(task(2, room: W.bathroom, recurrence: .recurring(frequency: .weekly, interval: 20)), at: wed),
    ]))
    list.append(Scenario(name: "diária, mensal e anual", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, recurrence: .recurring(frequency: .daily, interval: 9)), at: parse("2026-01-31T12:00:00Z")),
        .create(task(2, room: W.bathroom, effort: 3, recurrence: .recurring(frequency: .monthly, interval: 1)), at: parse("2026-01-31T12:00:00Z")),
        .create(task(3, room: W.kitchen, effort: 1, recurrence: .recurring(frequency: .yearly, interval: 1)), at: parse("2024-02-29T12:00:00Z")),
        .refresh(at: parse("2026-06-01T12:00:00Z")),
    ]))
    list.append(Scenario(name: "criação inválida não altera o estado", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, name: "   "), at: wed),
        .create(task(2, room: W.kitchen, recurrence: .none), at: wed),
        .create(task(3, room: W.kitchen, recurrence: .recurring(frequency: .weekly, interval: 0)), at: wed),
        .create(task(4, room: W.kitchen, policy: .selfAssigned), at: wed),
        .create(task(5, room: W.kitchen, kind: .sporadic, recurrence: weekly1, policy: .selfAssigned), at: wed),
        .create(task(6, room: uid(999)), at: wed),
        .create(task(7, room: W.kitchen, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 9, intervalWeeks: 1))), at: wed),
        .create(task(8, room: W.kitchen, effort: 1), at: wed),
    ]))
    list.append(Scenario(name: "esporádica nasce sem responsável", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2, kind: .sporadic, recurrence: .none, policy: .selfAssigned), at: wed),
        .suggestedResident(room: W.kitchen, at: wed),
        .create(task(2, room: W.kitchen, effort: 3), at: wed),
        .suggestedResident(room: W.kitchen, at: wed),
    ]))
    list.append(Scenario(name: "por conclusão: uma ocorrência e sucessoras", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 1, recurrence: .none, policy: .afterCompletion), at: wed),
        .complete(Ref(def: W.def(1), n: 0), by: .assigneeOf(Ref(def: W.def(1), n: 0)), at: days(1)),
        .complete(Ref(def: W.def(1), n: 0), by: .assigneeOf(Ref(def: W.def(1), n: 0)), at: days(1)),
        .complete(Ref(def: W.def(1), n: 1), by: .assigneeOf(Ref(def: W.def(1), n: 1)), at: days(3)),
        .complete(Ref(def: W.def(1), n: 2), by: .assigneeOf(Ref(def: W.def(1), n: 2)), at: days(5)),
        .refresh(at: days(10)),
    ]))
    list.append(Scenario(name: "cômodo compartilhado: tarefas vinculadas e refresh", zone: "UTC",
        state: world(kitchen: WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1), responsible: 2), steps: [
        .create(task(1, room: W.kitchen, effort: 3, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .create(task(2, room: W.kitchen, effort: 2, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .create(task(3, room: W.kitchen, effort: 2, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .create(task(4, room: W.kitchen, effort: 1, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .refresh(at: days(21)),
    ]))
    list.append(Scenario(name: "cômodo compartilhado, criação no meio do período e fora do cômodo", zone: "UTC",
        state: world(kitchen: WeeklyPeriodicity(executionsPerPeriod: 3, intervalWeeks: 2), responsible: 2), steps: [
        .create(task(1, room: W.kitchen, effort: 2, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 3, intervalWeeks: 2))), at: wed),
        .create(task(2, room: W.kitchen, effort: 3, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 3, intervalWeeks: 2))), at: days(8)),
        .create(task(3, room: W.bathroom, effort: 1), at: days(8)),
        .refresh(at: days(60)),
    ]))
    list.append(Scenario(name: "vinculada à periodicidade padrão do cômodo (1 vez por semana)", zone: "UTC",
        state: world(kitchen: WeeklyPeriodicity()), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: wed),
        .create(task(2, room: W.kitchen, effort: 1), at: wed),
        .refresh(at: days(100)),
    ]))
    list.append(Scenario(name: "várias tarefas em vários cômodos equilibram a casa", zone: "America/Sao_Paulo", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: wed),
        .create(task(2, room: W.kitchen, effort: 3), at: wed),
        .create(task(3, room: W.bathroom, effort: 2), at: wed),
        .create(task(4, room: W.whole, effort: 1), at: wed),
        .create(task(5, room: W.office, effort: 2), at: wed),
        .create(task(6, room: W.bathroom, effort: 1, recurrence: .recurring(frequency: .weekly, interval: 2)), at: wed),
    ]))
    list.append(Scenario(name: "fuso Tóquio", zone: "Asia/Tokyo", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: parse("2026-09-13T14:59:59Z")), // domingo 23:59:59 local
        .create(task(2, room: W.bathroom, effort: 3, recurrence: .recurring(frequency: .monthly, interval: 1)), at: parse("2026-09-13T15:00:00Z")), // segunda 00:00 local
    ]))
    return list
}

// MARK: Conclusão, reabertura, ausência, legado

func completeScenarios() -> [Scenario] {
    var list: [Scenario] = []
    let t1 = Ref(def: W.def(1), n: 0)
    list.append(Scenario(name: "conclusão: autorização, idempotência e reabertura", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: wed),
        .complete(t1, by: .user(uid(99)), at: wed),
        .complete(t1, by: .assigneeOf(t1), at: wed),
        .complete(t1, by: .assigneeOf(t1), at: days(1)),
        .complete(Ref(def: W.def(1), n: 3), by: .assigneeOf(Ref(def: W.def(1), n: 3)), at: wed),
        .complete(t1, by: .user(uid(1)), at: days(1)),
        .complete(t1, by: .user(uid(2)), at: days(1)),
        .complete(t1, by: .user(uid(3)), at: days(1)),
        .complete(t1, by: .user(uid(4)), at: days(1)),
        .reopen(t1, by: .user(uid(3))),
        .reopen(t1, by: .user(uid(1))),
        .reopen(t1, by: .user(uid(2))),
        .reopen(t1, by: .user(uid(4))),
        .complete(Ref(def: W.def(1), n: 1), by: .assigneeOf(Ref(def: W.def(1), n: 1)), at: days(7)),
    ]))
    list.append(Scenario(name: "saldo de justiça acumula e a reabertura o desfaz", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: wed),
        .create(task(2, room: W.kitchen, effort: 2), at: wed),
        .complete(Ref(def: W.def(1), n: 0), by: .assigneeOf(Ref(def: W.def(1), n: 0)), at: days(1)),
        .complete(Ref(def: W.def(2), n: 0), by: .assigneeOf(Ref(def: W.def(2), n: 0)), at: days(1)),
        .complete(Ref(def: W.def(1), n: 1), by: .assigneeOf(Ref(def: W.def(1), n: 1)), at: days(8)),
        .reopen(Ref(def: W.def(2), n: 0), by: .assigneeOf(Ref(def: W.def(2), n: 0))),
        .create(task(3, room: W.kitchen, effort: 3), at: days(9)),
    ]))
    var absent = world()
    absent.absences = []
    list.append(Scenario(name: "ausência exclui da fila publicada e impede conclusão", zone: "UTC", state: absent, steps: [
        .addAbsence(absence(1, user: 2, from: days(6), to: days(20))),
        .addAbsence(absence(2, user: 3, from: days(-30), to: days(30))),
        .create(task(1, room: W.kitchen, effort: 2), at: wed),
        .complete(Ref(def: W.def(1), n: 1), by: .user(uid(2)), at: days(8)),
        .complete(Ref(def: W.def(1), n: 2), by: .user(uid(3)), at: days(15)),
        .complete(Ref(def: W.def(1), n: 0), by: .assigneeOf(Ref(def: W.def(1), n: 0)), at: days(1)),
        .suggestedResident(room: W.kitchen, at: days(8)),
        .addMember(uid(4), room: W.office, at: days(2)),
    ]))
    // Legado: definição por conclusão sem fila, com ocorrência atribuída.
    var legacy = world()
    legacy.definitions = [task(1, room: W.kitchen, effort: 2, recurrence: .none, policy: .afterCompletion)]
    legacy.occurrences = [TaskOccurrence(id: uid(600), taskDefinitionID: W.def(1), availableAt: wed, dueAt: nil, status: .assigned,
        completedAt: nil, completedByUserID: nil, effortSnapshot: TaskEffort(points: 2))]
    legacy.assignments = [TaskAssignment(id: uid(700), occurrenceID: uid(600), userID: uid(2), assignedAt: wed, endedAt: nil)]
    list.append(Scenario(name: "legado por conclusão sem fila estabelece a fila na conclusão", zone: "UTC", state: legacy, steps: [
        .complete(Ref(def: W.def(1), n: 0), by: .user(uid(2)), at: days(2)),
        .complete(Ref(def: W.def(1), n: 1), by: .assigneeOf(Ref(def: W.def(1), n: 1)), at: days(4)),
        .refresh(at: days(6)),
    ]))
    // Esporádica já assumida.
    var sporadic = world()
    sporadic.definitions = [task(1, room: W.kitchen, effort: 3, kind: .sporadic, recurrence: .none, policy: .selfAssigned)]
    sporadic.occurrences = [TaskOccurrence(id: uid(600), taskDefinitionID: W.def(1), availableAt: wed, dueAt: nil, status: .assigned,
        completedAt: nil, completedByUserID: nil, effortSnapshot: TaskEffort(points: 3))]
    sporadic.assignments = [TaskAssignment(id: uid(700), occurrenceID: uid(600), userID: uid(1), assignedAt: wed, endedAt: nil)]
    list.append(Scenario(name: "esporádica assumida: concluir usa participação atual e não cria sucessora", zone: "UTC", state: sporadic, steps: [
        .complete(Ref(def: W.def(1), n: 0), by: .user(uid(2)), at: days(1)),
        .complete(Ref(def: W.def(1), n: 0), by: .user(uid(1)), at: days(1)),
        .complete(Ref(def: W.def(1), n: 0), by: .user(uid(1)), at: days(2)),
        .reopen(Ref(def: W.def(1), n: 0), by: .user(uid(1))),
    ]))
    return list
}

// MARK: Entrada e saída de participantes

func membershipScenarios() -> [Scenario] {
    var list: [Scenario] = []
    list.append(Scenario(name: "entrar e sair do cômodo replaneja a partir da próxima segunda", zone: "America/Sao_Paulo",
        state: world(kitchenMembers: 3), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: wed),
        .create(task(2, room: W.kitchen, effort: 2), at: wed),
        .addMember(uid(4), room: W.kitchen, at: days(1)),
        .addMember(uid(4), room: W.kitchen, at: days(1)),
        .removeMember(uid(1), room: W.kitchen, at: days(2)),
        .addMember(uid(1), room: W.kitchen, at: days(3)),
        .removeMember(uid(1), room: W.whole, at: days(3)),
        .removeMember(uid(2), room: W.kitchen, at: days(10)),
    ]))
    list.append(Scenario(name: "saída do último participante exige confirmação e exclui o cômodo", zone: "UTC",
        state: world(users: 2), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: wed),
        .create(task(2, room: W.bathroom, effort: 2), at: wed),
        .removeMember(uid(1), room: W.kitchen, at: days(1)),
        .removeMember(uid(2), room: W.kitchen, at: days(1)),
        .removeMember(uid(2), room: W.kitchen, at: days(1), confirmDeletion: true),
        .refresh(at: days(14)),
    ]))
    list.append(Scenario(name: "cômodo compartilhado: saída preserva o passado e replaneja como unidade", zone: "UTC",
        state: world(kitchen: WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1), responsible: 2), steps: [
        .create(task(1, room: W.kitchen, effort: 3, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .create(task(2, room: W.kitchen, effort: 1, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .removeMember(uid(2), room: W.kitchen, at: days(8)),
        .complete(Ref(def: W.def(1), n: 0), by: .assigneeOf(Ref(def: W.def(1), n: 0)), at: days(9)),
        .addMember(uid(2), room: W.kitchen, at: days(15)),
        .refresh(at: days(60)),
    ]))
    list.append(Scenario(name: "por conclusão: saída agenda a nova fila e a conclusão a ativa", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2, recurrence: .none, policy: .afterCompletion), at: wed),
        .removeMember(uid(3), room: W.kitchen, at: days(1)),
        .complete(Ref(def: W.def(1), n: 0), by: .assigneeOf(Ref(def: W.def(1), n: 0)), at: days(2)),
        .addMember(uid(3), room: W.kitchen, at: days(3)),
        .complete(Ref(def: W.def(1), n: 1), by: .assigneeOf(Ref(def: W.def(1), n: 1)), at: days(12)),
        .refresh(at: days(20)),
    ]))
    list.append(Scenario(name: "mudança de um cômodo reequilibra os outros da casa", zone: "UTC", state: world(kitchenMembers: 3), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: wed),
        .create(task(2, room: W.bathroom, effort: 3), at: wed),
        .create(task(3, room: W.whole, effort: 2), at: wed),
        .create(task(4, room: W.office, effort: 2), at: wed),
        .addMember(uid(4), room: W.kitchen, at: days(1), replan: false),
        .rebalance(boundary: parse("2026-09-21T00:00:00Z"), at: days(1)),
        .addMember(uid(3), room: W.office, at: days(1)),
    ]))
    list.append(Scenario(name: "criação durante mudança de participação pendente", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: wed),
        .removeMember(uid(1), room: W.kitchen, at: days(1)),
        .create(task(2, room: W.kitchen, effort: 3), at: days(2)),
        .create(task(3, room: W.bathroom, effort: 1), at: days(2)),
        .refresh(at: days(40)),
    ]))
    list.append(Scenario(name: "ausência e entrada de participante", zone: "UTC", state: world(kitchenMembers: 3), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: wed),
        .addAbsence(absence(1, user: 2, from: days(7), to: days(28))),
        .addMember(uid(4), room: W.kitchen, at: days(2)),
        .removeMember(uid(3), room: W.kitchen, at: days(9)),
        .suggestedResident(room: W.kitchen, at: days(9)),
    ]))
    list.append(Scenario(name: "saída e entrada em segunda-feira vale na segunda seguinte", zone: "UTC", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: parse("2026-09-21T00:00:00Z")),
        .removeMember(uid(2), room: W.kitchen, at: parse("2026-09-21T00:00:00Z")),
        .addMember(uid(2), room: W.kitchen, at: parse("2026-09-27T23:59:59Z")),
        .removeMember(uid(2), room: W.kitchen, at: parse("2026-09-28T00:00:00Z")),
    ]))
    return list
}

// MARK: Calendário e horário de verão

func calendarScenarios() -> [Scenario] {
    var list: [Scenario] = []
    list.append(Scenario(name: "Nova York: semanal e diária atravessam a mudança de março", zone: "America/New_York", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 3), at: parse("2026-03-01T15:00:00Z")),
        .create(task(2, room: W.bathroom, effort: 2, recurrence: .recurring(frequency: .daily, interval: 2)), at: parse("2026-03-06T07:30:00Z")),
    ]))
    list.append(Scenario(name: "Nova York: diária atravessa a repetição de novembro", zone: "America/New_York", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 1, recurrence: .recurring(frequency: .daily, interval: 2)), at: parse("2026-10-30T05:30:00Z")),
        .create(task(2, room: W.bathroom, effort: 2, recurrence: .recurring(frequency: .monthly, interval: 1)), at: parse("2026-10-31T05:30:00Z")),
    ]))
    list.append(Scenario(name: "Nova York: cômodo compartilhado atravessa março", zone: "America/New_York",
        state: world(kitchen: WeeklyPeriodicity(executionsPerPeriod: 3, intervalWeeks: 1), responsible: 2), steps: [
        .create(task(1, room: W.kitchen, effort: 2, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 3, intervalWeeks: 1))), at: parse("2026-02-25T15:00:00Z")),
        .create(task(2, room: W.kitchen, effort: 3, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 3, intervalWeeks: 1))), at: parse("2026-02-25T15:00:00Z")),
        .removeMember(uid(2), room: W.kitchen, at: parse("2026-03-04T15:00:00Z")),
    ]))
    list.append(Scenario(name: "São Paulo 2018: meia-noite inexistente e fim do horário de verão", zone: "America/Sao_Paulo", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2, recurrence: .recurring(frequency: .daily, interval: 2)), at: parse("2018-11-02T03:30:00Z")),
        .create(task(2, room: W.bathroom, effort: 3), at: parse("2018-10-31T14:00:00Z")),
        .create(task(3, room: W.whole, effort: 1, recurrence: .recurring(frequency: .daily, interval: 2)), at: parse("2018-02-15T02:00:00Z")),
    ]))
    list.append(Scenario(name: "pular muitas semanas materializa os períodos intermediários", zone: "America/Sao_Paulo",
        state: world(kitchen: WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1), responsible: 2), steps: [
        .create(task(1, room: W.kitchen, effort: 2), at: wed),
        .create(task(2, room: W.kitchen, effort: 3, recurrence: .weekly(WeeklyPeriodicity(executionsPerPeriod: 2, intervalWeeks: 1))), at: wed),
        .refresh(at: days(150)),
        .refresh(at: days(150)),
    ]))
    list.append(Scenario(name: "Lord Howe: mudança de meia hora", zone: "Australia/Lord_Howe", state: world(), steps: [
        .create(task(1, room: W.kitchen, effort: 2, recurrence: .recurring(frequency: .daily, interval: 3)), at: parse("2026-03-28T15:00:00Z")),
        .create(task(2, room: W.bathroom, effort: 3), at: parse("2026-09-27T12:00:00Z")),
    ]))
    return list
}
