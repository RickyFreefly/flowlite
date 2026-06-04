// routes/medios.js
import express from "express";
import { query } from "../db.js"; // 👈 usamos query en lugar de getConnection

const router = express.Router();

// ================== GET: Medios de Pago en uso ==================
router.get("/", async (req, res) => {
  try {
    const result = await query(`
      SELECT idmedio, nombre
      FROM medios_pago
      WHERE enuso = true
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error en GET /medios:", error);
    res.status(500).json({ error: "Error al obtener medios de pago" });
  }
});

export default router;
