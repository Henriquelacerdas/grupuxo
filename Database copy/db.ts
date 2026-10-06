import { Pool } from 'pg';

// Definimos a string de conexão primeiro em uma variável limpa
const connectionString = process.env.DATABASE_URL || "postgresql://meu_usuario:minha_senha_secreta@localhost:5432/meu_banco_de_dados?schema=public";

const pool = new Pool({
  connectionString: connectionString,
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export default pool;
