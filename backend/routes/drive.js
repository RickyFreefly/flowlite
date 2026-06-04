import express from "express";
import { crearCSV, subirCSV } from "../googleDrive.js";

const router = express.Router();

// POST /api/drive/export
router.post("/export", async (req, res) => {
  try {
    const data = req.body; // [{id, nombre, valor}, ...]
    await crearCSV(data);

    const result = await subirCSV("<ID_DE_TU_CARPETA>");
    res.json({ mensaje: "Archivo subido", ...result });
  } catch (error) {
    console.error("Error al exportar CSV:", error);
    res.status(500).json({ error: "No se pudo exportar CSV" });
  }
});

export default router;
