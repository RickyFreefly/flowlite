// testDb.js
import { getConnection } from "./db.js";

const test = async () => {
  try {
    const client = await getConnection();

    // Mostrar en qué BD estoy conectado
    const db = await client.query("SELECT current_database()");
    console.log("👉 Base de datos actual:", db.rows[0].current_database);

    // Mostrar esquema activo
    const schema = await client.query("SHOW search_path");
    console.log("👉 search_path:", schema.rows[0].search_path);

    // Verificar si existe la tabla en pg_tables
    const exists = await client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'clientes'
    `);
    console.log("👉 Existe clientes en public?:", exists.rows);

    // Contar registros
    const res = await client.query('SELECT count(*) FROM "public"."clientes"');
    console.log("👉 Total registros en clientes:", res.rows[0].count);

    // Traer algunos registros de prueba
    const sample = await client.query(`
      SELECT idcliente, identificacion, nombres, apellidos, email
      FROM "public"."clientes"
      LIMIT 5
    `);
    console.log("👉 Muestra de clientes:", sample.rows);

    client.release();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en test:", err.message);
    process.exit(1);
  }
};

test();
