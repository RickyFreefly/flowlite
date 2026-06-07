// routes/empresas.js
import express from "express";
import { query } from "../db.js";
import { authJwt } from "./authJwt.js";
import { companyAccess } from "./companyAccess.js";

const router = express.Router();

router.use(authJwt, companyAccess);

// ================== GET: Empresa activa ==================
router.get("/actual", async (req, res) => {
  try {
    const result = await query(
      `
      SELECT 
        idempresa,
        nombre,
        nit,
        logo_url,
        logo_ticket_url,
        activo
      FROM public.empresas
      WHERE idempresa = $1
      LIMIT 1
      `,
      [req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Empresa no encontrada",
      });
    }

    return res.json({
      success: true,
      empresa: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error obteniendo empresa activa:", error);

    return res.status(500).json({
      success: false,
      error: "Error obteniendo empresa activa",
    });
  }
});

export default router;