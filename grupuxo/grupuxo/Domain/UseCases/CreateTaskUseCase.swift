// TODO — Completar a validação além do nome: cômodo existente na casa ativa,
// acesso do solicitante e combinação coerente de tipo, recorrência e distribuição.
// Receber o contexto necessário pelo caso de uso, sem consultar sessão global.
// Para periódicas, coordenar geração das ocorrências e distribuição em caso de uso
// próprio; para avulsas, disponibilizar uma ocorrência sem responsável no card.
// Salvar novamente a mesma operação não deve gerar ocorrências duplicadas.

import Foundation

struct CreateTaskUseCase: Sendable {
    let repository: any TaskRepository

    func callAsFunction(definition: TaskDefinition) async throws -> TaskDefinition {
        guard !definition.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainError.invalidTaskName
        }
        return try await repository.create(definition)
    }
}
