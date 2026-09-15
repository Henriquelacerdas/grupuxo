// GUIA — Hoje este serviço apenas avança numa lista; ainda não calcula semanas.
// TODO: receber data de referência, calendário e uma referência estável de início
// da rotação por cômodo. A semana começa na segunda-feira; fuso/horário exatos
// precisam ser definidos com o grupo. Não depender de Date.now dentro da regra.
// Calcular o responsável da semana mesmo se a tarefa anterior não foi concluída;
// reabrir o app na mesma semana não deve avançar novamente. Tratar semanas sem
// abrir o app, nenhum elegível, uma pessoa e quantidades diferentes de cômodos/
// moradores. A ordem de entrada precisa ser estável para o resultado ser repetível.
// Persistir histórico no caso de uso/repositório, não neste calculador.

struct RotationCalculator: Sendable {
    func nextUser(after currentUserID: User.ID?, eligibleUserIDs: [User.ID]) -> User.ID? {
        guard !eligibleUserIDs.isEmpty else { return nil }
        guard let currentUserID, let index = eligibleUserIDs.firstIndex(of: currentUserID) else {
            return eligibleUserIDs.first
        }
        return eligibleUserIDs[(index + 1) % eligibleUserIDs.count]
    }
}
