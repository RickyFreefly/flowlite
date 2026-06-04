import pkg from "pg";
const { Pool } = pkg;

// Detecta automáticamente si estás en Render o local
const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // 🔹 Render requiere SSL
    })
  : new Pool({
      host: "localhost",
      user: "postgres",
      password: "123456",
      database: "flowlite",
      port: 5432,
    });

export const query = (text, params) => pool.query(text, params);
export const getConnection = () => pool.connect();
