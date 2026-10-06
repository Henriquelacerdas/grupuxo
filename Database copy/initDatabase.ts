import { query } from '../Database/db';

export async function initDatabase() {
    //TABELA DE USUÁRIOS
    const sqlUsers = `
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
                house_id UUID NOT NULL REFERENCES houses(id),
                apple_user_id VARCHAR(255) UNIQUE,
                name VARCHAR(255),
                email VARCHAR(255) UNIQUE,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
              );
        `;
    
    //TABELA DE CASAS
    const sqlHouse = `
            CREATE TABLE IF NOT EXISTS houses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE, 
                title VARCHAR(255) NOT NULL, 
                creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                share_link VARCHAR(500),
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `;
    
    //TABELA DE CÔMODOS
    const sqlRooms = `
            CREATE TABLE IF NOT EXISTS rooms (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
                house_id  UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                periodicity INT,
                is_common BOOLEAN,
        
                icon VARCHAR(100),
                color VARCHAR(100),
        
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `;
    
    //TABELA TASKS
    const sqlTasks = `
            CREATE TABLE IF NOT EXISTS tasks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
                room_id  UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description VARCHAR(255) NOT NULL,
                recurrence BOOLEAN,
                effort INT,
                periodicity INT,
                is_common BOOLEAN,
                is_active BOOLEAN,
        
                icon VARCHAR(100),
                color VARCHAR(100),
        
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        
                responsible UUID NOT NULL REFERENCES users(id)
            );
        `;
    
    //TABELA DOS MORADORES
    const sqlMembersHouse = `
    CREATE TABLE IF NOT EXISTS house_memberships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
        house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (house_id, user_id)
    );`
    
    //TABELA DOS habitantes do quarto
    const sqlMembersRoom = `
        CREATE TABLE IF NOT EXISTS room_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (room_id, user_id)
    );`
    
    // TABELA DAS OCORRENCIAS DAS TAREFAS
    const sqlTaskOccurrence = `
        CREATE TABLE IF NOT EXISTS task_occurrance (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            last_due_at TIMESTAMP,
            last_completed_at TIMESTAMP,
            statrus VARCHAR(50),
            sequence_number INT
    );`
        
    // JUSTIÇA
    const sqlJustica = `
        CREATE TABLE IF NOT EXISTS fairness_balance (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            debt FLOAT,
            updated_at TIMESTAMP
    );`

    // FERIAS
    const sqlFerias = `
        CREATE TABLE IF NOT EXISTS ferias (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            starts_at TIMESTAMP,
            ends_at TIMESTAMP,
            status VARCHAR(50)
        );
    `

    // NOTIFICACAO
    const sqlNotification = `
        CREATE TABLE IF NOT EXISTS notification (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            type VARCHAR(50),
            messagem VARCHAR(200),
            receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
            created_at TIMESTAMP,
            read_at TIMESTAMP
        );
    `

    // ENTRADA NO QUARTO
    const sqlPermissaoQuarto = `
        CREATE TABLE IF NOT EXISTS permission (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            rating INT,
            submitted_at TIMESTAMP,
            period_start TIMESTAMP,
            period_end TIMESTAMP
        );
    `
    
    // LUGAR NA FILA DA TAREFA
    const sqlSlotTask = `
        CREATE TABLE IF NOT EXISTS slotQueueTask (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
            position INT,
            effective_from TIMESTAMP,
            effective_to TIMESTAMP
        );
    `
    
    await query();

    // MIGRAÇÕES IDEMPOTENTES (bancos já existentes não são alterados por CREATE TABLE IF NOT EXISTS).
    // Permite excluir uma conta (DELETE /users) mesmo que o usuário tenha criado álbuns/figurinhas:
    // as FKs de criador passam a cascatear.
    const migrations = [
        `ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_creator_id_fkey,
            ADD CONSTRAINT albums_creator_id_fkey
            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;`,
        `ALTER TABLE stickers DROP CONSTRAINT IF EXISTS stickers_creator_id_fkey,
            ADD CONSTRAINT stickers_creator_id_fkey
            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;`,
    ];
    for (const sql of migrations) {
        try {
            await query(sql);
        } catch (e) {
            console.error('[initDatabase] migração falhou (seguindo mesmo assim):', e);
        }
    }

    console.log('PostgreSQL: Tabela stickers, albums e users e conexões verificada/criada.'); //Debug
}






//-- Extensão para UUIDs (opcional, caso utilize UUIDs nos modelos Swift)
//CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
//
//-- 1. Utilizadores
//CREATE TABLE users (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    name VARCHAR(255) NOT NULL,
//    email VARCHAR(255) UNIQUE NOT NULL,
//    password_hash VARCHAR(255),
//    avatar_url TEXT,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 2. Habitações / Casas
//CREATE TABLE houses (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    name VARCHAR(255) NOT NULL,
//    invite_code VARCHAR(50) UNIQUE,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 3. Membros da Habitação (Relação N:N User <-> House com funções/permissões)
//CREATE TABLE house_memberships (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    role VARCHAR(50) DEFAULT 'member', -- ex: 'admin', 'member'
//    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    UNIQUE (house_id, user_id)
//);
//
//-- 4. Divisões / Quartos
//CREATE TABLE rooms (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
//    name VARCHAR(100) NOT NULL,
//    description TEXT,
//    is_private BOOLEAN DEFAULT FALSE,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 5. Membros da Divisão (Mapeamento de quem ocupa/usa a divisão)
//CREATE TABLE room_memberships (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    UNIQUE (room_id, user_id)
//);
//
//-- 6. Pedidos de Acesso a Divisões
//CREATE TABLE room_access_requests (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    status VARCHAR(50) DEFAULT 'pending', -- ex: 'pending', 'approved', 'rejected'
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 7. Definição/Modelo de Tarefas (Configuração da rotina/recorrência)
//CREATE TABLE task_definitions (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
//    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
//    title VARCHAR(255) NOT NULL,
//    description TEXT,
//    points INT DEFAULT 0,
//    recurrence_rule TEXT, -- Ex: Cron expression, 'weekly', 'daily', RRULE
//    is_active BOOLEAN DEFAULT TRUE,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 8. Ocorrência de Tarefas (Instância gerada num ciclo específico)
//CREATE TABLE task_occurrences (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    task_definition_id UUID NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
//    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
//    status VARCHAR(50) DEFAULT 'pending', -- ex: 'pending', 'completed', 'skipped'
//    completed_at TIMESTAMP WITH TIME ZONE,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 9. Atribuição de Tarefas (A quem a ocorrência foi designada)
//CREATE TABLE task_assignments (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    task_occurrence_id UUID NOT NULL REFERENCES task_occurrences(id) ON DELETE CASCADE,
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    is_completed BOOLEAN DEFAULT FALSE,
//    UNIQUE (task_occurrence_id, user_id)
//);
//
//-- 10. Pedidos de Troca de Tarefas
//CREATE TABLE task_swap_requests (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    source_assignment_id UUID NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
//    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    target_assignment_id UUID REFERENCES task_assignments(id) ON DELETE SET NULL,
//    status VARCHAR(50) DEFAULT 'pending', -- ex: 'pending', 'accepted', 'rejected', 'cancelled'
//    reason TEXT,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 11. Sugestões de Tarefas
//CREATE TABLE task_suggestions (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    title VARCHAR(255) NOT NULL,
//    description TEXT,
//    status VARCHAR(50) DEFAULT 'pending', -- ex: 'pending', 'approved', 'rejected'
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 12. Ausências (Férias, viagens, períodos sem atribuição)
//CREATE TABLE absences (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    start_date DATE NOT NULL,
//    end_date DATE NOT NULL,
//    reason TEXT,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- 13. Notificações da Aplicação
//CREATE TABLE app_notifications (
//    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//    title VARCHAR(255) NOT NULL,
//    body TEXT NOT NULL,
//    type VARCHAR(50), -- ex: 'task_assigned', 'swap_request', 'room_invite'
//    is_read BOOLEAN DEFAULT FALSE,
//    payload JSONB,
//    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
//);
//
//-- Índices recomendados para otimização de consultas frequentes
//CREATE INDEX idx_house_memberships_user ON house_memberships(user_id);
//CREATE INDEX idx_task_definitions_house ON task_definitions(house_id);
//CREATE INDEX idx_task_occurrences_due_date ON task_occurrences(due_date);
//CREATE INDEX idx_task_assignments_user ON task_assignments(user_id);
//CREATE INDEX idx_app_notifications_user_unread ON app_notifications(user_id) WHERE is_read = FALSE;
//CREATE INDEX idx_absences_user_dates ON absences(user_id, start_date, end_date);
