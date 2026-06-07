// db.js
import pkg from "pg";
const { Pool } = pkg;

// Detecta automáticamente si estás en Render o local
const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Render requiere SSL

      // Evita que se quede colgado indefinidamente
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      query_timeout: 15000,
    })
  : new Pool({
      host: "localhost",
      user: "postgres",
      password: "123456",
      database: "flowlite",
      port: 5432,

      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      query_timeout: 15000,
    });

pool.on("connect", () => {
  console.log("✅ Conectado a PostgreSQL");
});

pool.on("error", (err) => {
  console.error("❌ Error inesperado en PostgreSQL:", err);
});

export const query = (text, params) => pool.query(text, params);

export const getConnection = () => pool.connect();

export { pool };