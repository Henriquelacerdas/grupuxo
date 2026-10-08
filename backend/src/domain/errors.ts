const MESSAGES = {
  deletionConfirmationRequired:
    "Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos.",
  wholeHouseProtected: "Casa toda sempre inclui todos os moradores e não permite saída individual nem exclusão.",
  invalidDistribution: "A distribuição de tarefas é inválida.",
  noEligibleMembers: "O cômodo não possui participantes elegíveis.",
  invalidSchedule: "A periodicidade e a política da tarefa são incompatíveis.",
  entityNotFound: "Item não encontrado.",
  invalidDateInterval: "O período informado é inválido.",
  invalidTaskName: "Informe um nome para a tarefa.",
  invalidResidentName: "Informe o nome do morador.",
  cannotRemoveCurrentUser: "Você não pode remover seu próprio perfil da casa.",
  invalidRoomName: "Informe um nome para o cômodo.",
  invalidRoomParticipants: "O cômodo precisa ter participantes válidos.",
  taskAlreadyCompleted: "Esta tarefa já foi concluída.",
  taskUnavailable: "Esta tarefa não está disponível.",
} as const;

export type DomainErrorCode = keyof typeof MESSAGES;

/** Erro de regra de negócio. `code` é o contrato estável; `message` é o texto em português para o usuário. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode) {
    super(MESSAGES[code]);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(error: unknown, code?: DomainErrorCode): error is DomainError {
  return error instanceof DomainError && (code === undefined || error.code === code);
}
