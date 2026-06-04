import { Router } from "express";
import { obtenerReservas } from "../services/reservasService.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const reservas = await obtenerReservas();
    res.json({
      ok: true,
      total: reservas.length,
      data: reservas
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

export default router;
