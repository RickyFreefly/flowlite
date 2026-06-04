// db/mysql.js
import mysql from "mysql2/promise";

// Detectar si hay variable de entorno tipo Render
// Puedes usar: MYSQL_URL o DATABASE_URL
const connectionString = process.env.MYSQL_URL;

let pool;

if (connectionString) {
  console.log("🔵 Conectando a MySQL usando VARIABLES DE ENTORNO (Render)");

  pool = mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
      rejectUnauthorized: false, // cambia a false si tu hosting lo exige
    },
  });

} else {
  console.log("🟢 Conectando a MySQL en LOCAL");

  pool = mysql.createPool({
    host: "50.87.184.56",
    user: "tozzbzmy_WPYYB",
    password: "&.IfibQ3#eHw[^vAW",
    database: "tozzbzmy_WPYYB",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
     ssl: false, 
  });
}

export const mysqlConn = pool;
export const mysqlQuery = (sql, params = []) => pool.query(sql, params);
export const getMySQLConnection = () => pool.getConnection();
