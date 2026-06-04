// routes/coach.js
import express from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../services/authMiddleware.js";

const router = express.Router();

/**
 * ================================
 * GET /api/coach/activos
 * Público (o protegido por authJwt en server.js si lo dejaste así):
 * Lista coaches activos
 * ================================
 */
router.get("/activos", async (req, res) => {
  try {
    const r = await query(
      `SELECT idcoach, nombre, email
       FROM coach
       WHERE activo = TRUE
       ORDER BY nombre`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("❌ Error listando coaches activos:", e);
    res.status(500).json({ error: "Error listando coaches activos" });
  }
});

/**
 * ================================
 * GET /api/coach
 * ADMIN: lista todos los coaches
 * ================================
 */
router.get("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const r = await query(
      `SELECT idcoach, nombre, idusuario
       FROM coach
       ORDER BY nombre ASC`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("❌ Error listando coaches:", e);
    res.status(500).json({ error: "Error listando coaches" });
  }
});

/**
 * ================================
 * POST /api/coach
 * ADMIN: crear coach
 * body: { nombre }
 * ================================
 */
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: "nombre es obligatorio" });
    }

    const r = await query(
      `INSERT INTO coach (nombre) VALUES ($1)
       RETURNING idcoach, nombre, idusuario`,
      [String(nombre).trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("❌ Error creando coach:", e);
    res.status(500).json({ error: "Error creando coach" });
  }
});

/**
 * ================================
 * PUT /api/coach/:idcoach/vincular-usuario
 * ADMIN: vincula coach a usuario
 * body: { idusuario }
 * ================================
 */
router.put("/:idcoach/vincular-usuario", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const idcoach = Number(req.params.idcoach);
    const idusuario = Number(req.body.idusuario);

    if (!Number.isInteger(idcoach) || !Number.isInteger(idusuario)) {
      return res.status(400).json({ error: "idcoach e idusuario son obligatorios" });
    }

    // Asegurar que el usuario sea COACH (opcional)
    await query(`UPDATE usuarios SET rol='COACH' WHERE idusuario=$1`, [idusuario]);

    const r = await query(
      `UPDATE coach
       SET idusuario=$1
       WHERE idcoach=$2
       RETURNING idcoach, nombre, idusuario`,
      [idusuario, idcoach]
    );

    if (!r.rows[0]) return res.status(404).json({ error: "Coach no encontrado" });
    res.json(r.rows[0]);
  } catch (e) {
    console.error("❌ Error vinculando usuario a coach:", e);
    res.status(500).json({ error: "Error vinculando usuario" });
  }
});

export default router;
