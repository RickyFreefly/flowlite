import express from "express";
import { query } from "../db.js";

const router = express.Router();

/**
 * ================================
 * 💰 POST: Crear Movimiento en Caja
 * ================================
 */
router.post("/", async (req, res) => {
  try {
    const { fecha, concepto, proveedor, valor, movimiento, observacion, idusuario } = req.body;

    if (!fecha || !concepto || !proveedor || !valor || !idusuario) {
      return res
        .status(400)
        .json({ error: "Fecha, concepto, proveedor, valor y usuario son obligatorios" });
    }

    // 1️⃣ Insertar registro en caja
    const resultCaja = await query(
      `INSERT INTO caja 
        (fecha, concepto, proveedor, valor, movimiento, observacion, createdat, updatedat, createdby)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7)
       RETURNING *`,
      [fecha, concepto, proveedor, valor, movimiento, observacion, idusuario]
    );

    const caja = resultCaja.rows[0];

    // 2️⃣ Obtener datos del usuario
    const resultUsuario = await query(
      "SELECT idusuario, username, email FROM usuarios WHERE idusuario = $1",
      [idusuario]
    );
    const usuario = resultUsuario.rows[0] || null;

    // 3️⃣ Enviar respuesta
    res.json({
      message: "Movimiento en caja registrado exitosamente",
      caja,
      usuario: usuario ? { id: usuario.idusuario, username: usuario.username } : null,
    });
  } catch (error) {
    console.error("❌ Error creando movimiento en caja:", error);
    res.status(500).json({ error: "Error creando movimiento en caja" });
  }
});

/**
 * ================================
 * ✏️ PATCH: Actualizar Observación
 * ================================
 */
router.patch("/:id/observacion", async (req, res) => {
  try {
    const { observacion } = req.body;

    if (!observacion) {
      return res.status(400).json({ error: "La observación es requerida" });
    }

    const result = await query(
      `UPDATE caja
       SET observacion = CONCAT(COALESCE(observacion, ''), ' | ', $1),
           updatedat = NOW()
       WHERE idcaja = $2
       RETURNING *`,
      [observacion, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    res.json({ message: "Observación actualizada", caja: result.rows[0] });
  } catch (error) {
    console.error("❌ Error actualizando observación en caja:", error);
    res.status(500).json({ error: "Error actualizando observación" });
  }
});

/**
 * ================================
 * 📋 GET: Listar Movimientos de Caja
 * ================================
 */
router.get("/", async (req, res) => {
  try {
    const result = await query(`
      SELECT c.idcaja, c.fecha, c.concepto, c.proveedor, c.valor,
             c.movimiento, c.observacion, c.createdat, c.updatedat,
             u.username AS usuario
      FROM caja c
      LEFT JOIN usuarios u ON u.idusuario = c.createdby
      ORDER BY c.fecha DESC, c.idcaja DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error listando movimientos de caja:", error);
    res.status(500).json({ error: "Error al obtener movimientos de caja" });
  }
});

/**
 * ================================
 * 🔍 GET: Movimiento de Caja por ID
 * ================================
 */
router.get("/:id", async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, u.username AS usuario
       FROM caja c
       LEFT JOIN usuarios u ON u.idusuario = c.createdby
       WHERE c.idcaja = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo movimiento de caja:", error);
    res.status(500).json({ error: "Error al obtener movimiento de caja" });
  }
});

export default router;
