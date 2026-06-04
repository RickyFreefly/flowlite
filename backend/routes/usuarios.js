// routes/usuarios.js
import express from "express";
import { query } from "../db.js"; // 👈 usamos query directo del pool
import bcrypt from "bcrypt";

const router = express.Router();

// ================== GET: Listar usuarios ==================
router.get("/", async (req, res) => {
  try {
    const result = await query("SELECT * FROM usuarios ORDER BY idusuario ASC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error obteniendo usuarios:", error);
    res.status(500).json({ error: "Error obteniendo usuarios" });
  }
});

// ================== GET: Usuario por ID ==================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query("SELECT * FROM usuarios WHERE idusuario = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo usuario:", error);
    res.status(500).json({ error: "Error obteniendo usuario" });
  }
});

// ================== POST: Crear usuario ==================
router.post("/", async (req, res) => {
  try {
    const { nombrecompleto, username, passwordhash, rol, email } = req.body;

    if (!nombrecompleto || !username || !passwordhash) {
      return res.status(400).json({ error: "Nombre, username y contraseña son obligatorios" });
    }

    // 🔐 Encriptar contraseña antes de guardar
    const hashedPassword = await bcrypt.hash(passwordhash, 10);

    const result = await query(
      `INSERT INTO usuarios (nombrecompleto, username, passwordhash, rol, email, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [nombrecompleto, username, hashedPassword, rol || "CAJERO", email]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creando usuario:", error);
    res.status(500).json({ error: "Error creando usuario" });
  }
});

// ================== PUT: Actualizar usuario ==================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let { nombrecompleto, username, passwordhash, rol, email, activo } = req.body;

    // Si se envía nueva contraseña, la encriptamos
    if (passwordhash) {
      passwordhash = await bcrypt.hash(passwordhash, 10);
    } else {
      // Si no se envía, mantener la actual
      const resultOld = await query(
        "SELECT passwordhash FROM usuarios WHERE idusuario=$1",
        [id]
      );
      if (resultOld.rows.length > 0) {
        passwordhash = resultOld.rows[0].passwordhash;
      }
    }

    const result = await query(
      `UPDATE usuarios
       SET nombrecompleto=$1, username=$2, passwordhash=$3, rol=$4, email=$5, activo=$6, updatedat=NOW()
       WHERE idusuario=$7
       RETURNING *`,
      [nombrecompleto, username, passwordhash, rol, email, activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error actualizando usuario:", error);
    res.status(500).json({ error: "Error actualizando usuario" });
  }
});

// ================== DELETE: Eliminar usuario ==================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query("DELETE FROM usuarios WHERE idusuario=$1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ mensaje: "Usuario eliminado", usuario: result.rows[0] });
  } catch (error) {
    console.error("❌ Error eliminando usuario:", error);
    res.status(500).json({ error: "Error eliminando usuario" });
  }
});

export default router;
