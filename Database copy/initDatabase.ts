//import { query } from '../Database/db';
//
//export async function initDatabase() {
//    //TABELA DE USUÁRIOS
//    const sqlUsers = `
//            CREATE TABLE IF NOT EXISTS users (
//                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//                house_id UUID NOT NULL REFERENCES houses(id),
//                apple_user_id VARCHAR(255) UNIQUE,
//                name VARCHAR(255),
//                email VARCHAR(255) UNIQUE,
//                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
//                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
//              );
//        `;
//    
//    //TABELA DE CASAS
//    const sqlHouse = `
//            CREATE TABLE IF NOT EXISTS houses (
//                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE, 
//                title VARCHAR(255) NOT NULL, 
//                creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//                share_link VARCHAR(500),
//                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
//                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
//            );
//        `;
//    
//    //TABELA DE CÔMODOS
//    const sqlRooms = `
//            CREATE TABLE IF NOT EXISTS rooms (
//                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//                house_id  UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
//                name VARCHAR(255) NOT NULL,
//                periodicity INT,
//                is_common BOOLEAN,
//        
//                icon VARCHAR(100),
//                color VARCHAR(100),
//        
//                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
//                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
//            );
//        `;
//    
//    //TABELA TASKS
//    const sqlTasks = `
//            CREATE TABLE IF NOT EXISTS tasks (
//                id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//                room_id  UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
//                name VARCHAR(255) NOT NULL,
//                description VARCHAR(255) NOT NULL,
//                recurrence BOOLEAN,
//                effort INT,
//                periodicity INT,
//                is_common BOOLEAN,
//                is_active BOOLEAN,
//        
//                icon VARCHAR(100),
//                color VARCHAR(100),
//        
//                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
//                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
//        
//                responsible UUID NOT NULL REFERENCES users(id)
//            );
//        `;
//    
//    //TABELA DOS MORADORES
//    const sqlMembersHouse = `
//    CREATE TABLE IF NOT EXISTS house_memberships (
//        id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//        house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
//        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//        joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//        UNIQUE (house_id, user_id)
//    );`
//    
//    //TABELA DOS habitantes do quarto
//    const sqlMembersRoom = `
//        CREATE TABLE IF NOT EXISTS room_memberships (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
//            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//            UNIQUE (room_id, user_id)
//    );`
//    
//    // TABELA DAS OCORRENCIAS DAS TAREFAS
//    const sqlTaskOccurrence = `
//        CREATE TABLE IF NOT EXISTS task_occurrance (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            last_due_at TIMESTAMP,
//            last_completed_at TIMESTAMP,
//            statrus VARCHAR(50),
//            sequence_number INT
//    );`
//        
//    // JUSTIÇA
//    const sqlJustica = `
//        CREATE TABLE IF NOT EXISTS fairness_balance (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            debt FLOAT,
//            updated_at TIMESTAMP
//    );`
//
//    // FERIAS
//    const sqlFerias = `
//        CREATE TABLE IF NOT EXISTS ferias (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            starts_at TIMESTAMP,
//            ends_at TIMESTAMP,
//            status VARCHAR(50)
//        );
//    `
//
//    // NOTIFICACAO
//    const sqlNotification = `
//        CREATE TABLE IF NOT EXISTS notification (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            type VARCHAR(50),
//            messagem VARCHAR(200),
//            receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
//            created_at TIMESTAMP,
//            read_at TIMESTAMP
//        );
//    `
//
//    // ENTRADA NO QUARTO
//    const sqlPermissaoQuarto = `
//        CREATE TABLE IF NOT EXISTS permission (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            rating INT,
//            submitted_at TIMESTAMP,
//            period_start TIMESTAMP,
//            period_end TIMESTAMP
//        );
//    `
//    
//    // LUGAR NA FILA DA TAREFA
//    const sqlSlotTask = `
//        CREATE TABLE IF NOT EXISTS slotQueueTask (
//            id UUID PRIMARY KEY DEFAULT gen_random_uuid() UNIQUE,
//            position INT,
//            effective_from TIMESTAMP,
//            effective_to TIMESTAMP
//        );
//    `
//    
//    await query();
//
//    // MIGRAÇÕES IDEMPOTENTES (bancos já existentes não são alterados por CREATE TABLE IF NOT EXISTS).
//    // Permite excluir uma conta (DELETE /users) mesmo que o usuário tenha criado álbuns/figurinhas:
//    // as FKs de criador passam a cascatear.
//    const migrations = [
//        `ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_creator_id_fkey,
//            ADD CONSTRAINT albums_creator_id_fkey
//            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;`,
//        `ALTER TABLE stickers DROP CONSTRAINT IF EXISTS stickers_creator_id_fkey,
//            ADD CONSTRAINT stickers_creator_id_fkey
//            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;`,
//    ];
//    for (const sql of migrations) {
//        try {
//            await query(sql);
//        } catch (e) {
//            console.error('[initDatabase] migração falhou (seguindo mesmo assim):', e);
//        }
//    }
//
//    console.log('PostgreSQL: Tabela stickers, albums e users e conexões verificada/criada.'); //Debug
//}
