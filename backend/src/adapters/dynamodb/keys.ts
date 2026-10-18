/**
 * Interface que define a estrutura de chaves primárias e secundárias
 * utilizadas na Single-Table Design do DynamoDB.
 */
export interface DynamoDBKeys {
  PK: string;
  SK: string;
  GSI1_PK?: string;
  GSI1_SK?: string;
}

/**
 * Utilitário centralizado para construir chaves com prefixos padronizados.
 */
export const KeyBuilder = {
    /**
     * --- 1. ENTIDADES DO WHATSAPP ---
     */
    
    // Chave para Metadados da Sessão do WhatsApp
    whatsAppSession: (sessionId: string): DynamoDBKeys => ({
        PK: `WA#SESSION#${sessionId}`,
        SK: `METADATA`
    }),
    
    // Chaves para Mensagens do WhatsApp ligadas a uma Sessão
    whatsAppMessage: (
                      sessionId: string,
                      messageId: string,
                      timestamp: string | number = Date.now()
                      ): DynamoDBKeys => ({
                          PK: `WA#SESSION#${sessionId}`,
                          SK: `MSG#${timestamp}#${messageId}`
                      }),
    
    // Chaves para Contactos/Instâncias do WhatsApp
    whatsAppContact: (phoneNumber: string): DynamoDBKeys => ({
        PK: `WA#CONTACT#${phoneNumber}`,
        SK: `METADATA`
    }),
    
    /**
     * --- 2. ENTIDADES GENÉRICAS (Substituição do antigo create.js) ---
     */
    
    // Registo de qualquer entidade genérica (ex: USER, ORDER, DEVICE, HOUSE)
    entityRecord: (entityType: string, id: string): DynamoDBKeys => ({
        PK: `ENTITY#${entityType.toUpperCase()}`,
        SK: `ID#${id}`
    }),
    
    /**
     * --- 3. ÍNDICE DE PESQUISA GSI1 (Substituição do antigo search.js) ---
     */
    
    // Atributos de pesquisa para o Índice Secundário Global (GSI1)
    searchIndex: (category: string, searchKey: string) => ({
        GSI1_PK: `SEARCH#${category.toUpperCase()}`,
        GSI1_SK: searchKey.toLowerCase()
    }),
    
    /**
     * --- 4. COMBINAÇÕES MISTAS (Criação + Indexação de Pesquisa) ---
     */
    
    // Cria as chaves principais e injeta os atributos de pesquisa num único objeto
    recordWithSearch: (
                       entityType: string,
                       id: string,
                       searchCategory: string,
                       searchKeyword: string
                       ): DynamoDBKeys => ({
                           ...KeyBuilder.entityRecord(entityType, id),
                           ...KeyBuilder.searchIndex(searchCategory, searchKeyword)
                       }),
    
    // Indexa uma mensagem do WhatsApp para ser encontrada por pesquisa de palavra-chave/categoria
    whatsAppMessageWithSearch: (
                                sessionId: string,
                                messageId: string,
                                searchCategory: string,
                                searchKeyword: string,
                                timestamp: string | number = Date.now()
                                ): DynamoDBKeys => ({
                                    ...KeyBuilder.whatsAppMessage(sessionId, messageId, timestamp),
                                    ...KeyBuilder.searchIndex(searchCategory, searchKeyword)
                                }),
    
    // Perfil de Utilizador
    profile: (profileId: string) => ({
        PK: `PROFILE#${profileId}`,
        SK: `METADATA`
    }),
    
    // Casa
    house: (houseId: string) => ({
        PK: `HOUSE#${houseId}`,
        SK: `METADATA`
    }),
    
    // Quarto (vinculado diretamente a uma Casa)
    room: (houseId: string, roomId: string) => ({
        PK: `HOUSE#${houseId}`,
        SK: `ROOM#${roomId}`
    }),

    // Tarefa vinculada a uma Casa
    task: (houseId: string, taskId: string) => ({
      PK: `HOUSE#${houseId}`,
      SK: `TASK#${taskId}`
    }),

    // Tarefa vinculada a um Perfil de Utilizador (ex: tarefas pessoais)
    userTask: (profileId: string, taskId: string) => ({
      PK: `PROFILE#${profileId}`,
      SK: `TASK#${taskId}`
    })
};
