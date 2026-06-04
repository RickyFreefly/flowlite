// routes/egresos.js
import express from "express";
import { query } from "../db.js";
import { authJwt } from "./authJwt.js";
import { companyAccess } from "./companyAccess.js";

const router = express.Router();

/**
 * Todas las rutas de egresos quedan protegidas por:
 * 1. authJwt: valida el usuario autenticado.
 * 2. companyAccess: valida que el usuario tenga acceso a la empresa enviada en x-empresa-id.
 */
router.use(authJwt, companyAccess);

/**
 * Helper: escapar CSV correctamente
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

/**
 * Helper: limpiar texto
 */
function limpiarTexto(value) {
  if (value === null || value === undefined) return null;
  const texto = String(value).trim();
  return texto === "" ? null : texto;
}

/**
 * Helper: validar número
 */
function limpiarNumero(value) {
  if (value === null || value === undefined || value === "") return null;

  const numero = Number(value);

  if (Number.isNaN(numero)) {
    return NaN;
  }

  return numero;
}

/**
 * ================== GET: Exportar Egresos CSV ==================
 * URL:
 * /egresos/exportar?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD
 */
router.get("/exportar", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        success: false,
        error: "fecha_inicio y fecha_fin son obligatorios. Formato: YYYY-MM-DD",
      });
    }

    const sql = `
      SELECT 
        e.idegreso AS id,
        e.fecha,
        e.concepto,
        e.proveedor,
        e.valor,
        e.metodopago,
        e.observacion,
        u.username AS usuario
      FROM public.egresos e
      LEFT JOIN public.usuarios u ON u.idusuario = e.createdby
      WHERE e.idempresa = $1
        AND e.fecha >= $2::date
        AND e.fecha < ($3::date + INTERVAL '1 day')
      ORDER BY e.fecha DESC
    `;

    const result = await query(sql, [
      req.idempresa,
      fecha_inicio,
      fecha_fin,
    ]);

    const headers = [
      "id",
      "fecha",
      "concepto",
      "proveedor",
      "valor",
      "metodopago",
      "observacion",
      "usuario",
    ];

    const lines = [];
    lines.push(headers.join(","));

    for (const row of result.rows) {
      lines.push(headers.map((h) => escapeCSV(row[h])).join(","));
    }

    const csv = lines.join("\n");
    const filename = `egresos_${fecha_inicio}_a_${fecha_fin}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    return res.status(200).send(csv);
  } catch (error) {
    console.error("❌ Error exportando egresos:", error);

    return res.status(500).json({
      success: false,
      error: "Error exportando egresos",
    });
  }
});

// ================== POST: Crear Egreso ==================
router.post("/", async (req, res) => {
  try {
    let {
      fecha,
      concepto,
      proveedor,
      valor,
      metodopago,
      observacion,
    } = req.body;

    fecha = limpiarTexto(fecha);
    concepto = limpiarTexto(concepto);
    proveedor = limpiarTexto(proveedor);
    metodopago = limpiarTexto(metodopago);
    observacion = limpiarTexto(observacion);
    valor = limpiarNumero(valor);

    if (!fecha || !concepto || !proveedor || valor === null) {
      return res.status(400).json({
        success: false,
        error: "Fecha, concepto, proveedor y valor son obligatorios",
      });
    }

    if (Number.isNaN(valor) || valor <= 0) {
      return res.status(400).json({
        success: false,
        error: "El valor debe ser un número válido mayor a cero",
      });
    }

    const resultEgreso = await query(
      `
      INSERT INTO public.egresos (
        idempresa,
        fecha,
        concepto,
        proveedor,
        valor,
        metodopago,
        observacion,
        createdat,
        updatedat,
        createdby
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8)
      RETURNING *
      `,
      [
        req.idempresa,
        fecha,
        concepto,
        proveedor,
        valor,
        metodopago,
        observacion,
        req.user.idusuario,
      ]
    );

    const egreso = resultEgreso.rows[0];

    const resultUsuario = await query(
      `
      SELECT idusuario, username, email
      FROM public.usuarios
      WHERE idusuario = $1
      LIMIT 1
      `,
      [req.user.idusuario]
    );

    const usuario = resultUsuario.rows[0] || null;

    return res.status(201).json({
      success: true,
      message: "Egreso creado",
      egreso,
      usuario: usuario
        ? {
            id: usuario.idusuario,
            username: usuario.username,
            email: usuario.email,
          }
        : null,
    });
  } catch (error) {
    console.error("❌ Error creando egreso:", error);

    return res.status(500).json({
      success: false,
      error: "Error creando egreso",
    });
  }
});

// ================== PATCH: Actualizar Estado ==================
router.patch("/:id/estado", async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!["PENDIENTE", "PAGADO", "ANULADO"].includes(estado)) {
      return res.status(400).json({
        success: false,
        error: "Estado inválido",
      });
    }

    const result = await query(
      `
      UPDATE public.egresos
      SET observacion = CONCAT(
            COALESCE(observacion, ''),
            CASE 
              WHEN COALESCE(observacion, '') = '' THEN ''
              ELSE ' | '
            END,
            'Estado cambiado a: ',
            $1::text
          ),
          updatedat = NOW()
      WHERE idegreso = $2
        AND idempresa = $3
      RETURNING *
      `,
      [estado, id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Egreso no encontrado",
      });
    }

    return res.json({
      success: true,
      message: "Estado actualizado",
      egreso: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error actualizando estado de egreso:", error);

    return res.status(500).json({
      success: false,
      error: "Error actualizando estado",
    });
  }
});

// ================== GET: Listar Egresos ==================
// Soporta:
// /egresos?proveedor=papeleria
// /egresos?fecha_inicio=2026-02-07&fecha_fin=2026-02-08
// /egresos?proveedor=papeleria&fecha_inicio=...&fecha_fin=...
router.get("/", async (req, res) => {
  try {
    const { proveedor, fecha_inicio, fecha_fin } = req.query;

    const where = ["e.idempresa = $1"];
    const params = [req.idempresa];

    if (proveedor && proveedor.trim()) {
      params.push(`%${proveedor.trim()}%`);
      where.push(`e.proveedor ILIKE $${params.length}`);
    }

    if (fecha_inicio && fecha_fin) {
      params.push(fecha_inicio);
      params.push(fecha_fin);

      where.push(
        `e.fecha >= $${params.length - 1}::date AND e.fecha < ($${params.length}::date + INTERVAL '1 day')`
      );
    } else if (fecha_inicio) {
      params.push(fecha_inicio);
      where.push(`e.fecha >= $${params.length}::date`);
    } else if (fecha_fin) {
      params.push(fecha_fin);
      where.push(`e.fecha < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const sql = `
      SELECT 
        e.idegreso,
        e.idempresa,
        e.fecha,
        e.concepto,
        e.proveedor,
        e.valor,
        e.metodopago,
        e.observacion,
        e.createdat,
        e.updatedat,
        e.createdby,
        u.username AS usuario
      FROM public.egresos e
      LEFT JOIN public.usuarios u ON u.idusuario = e.createdby
      WHERE ${where.join(" AND ")}
      ORDER BY e.fecha DESC, e.createdat DESC
    `;

    const result = await query(sql, params);

    return res.json(result.rows);
  } catch (error) {
    console.error("❌ Error listando egresos:", error);

    return res.status(500).json({
      success: false,
      error: "Error al obtener egresos",
    });
  }
});

// ================== GET: Egreso por ID ==================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT 
        e.*,
        u.username AS usuario
      FROM public.egresos e
      LEFT JOIN public.usuarios u ON u.idusuario = e.createdby
      WHERE e.idegreso = $1
        AND e.idempresa = $2
      LIMIT 1
      `,
      [id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Egreso no encontrado",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo egreso:", error);

    return res.status(500).json({
      success: false,
      error: "Error al obtener egreso",
    });
  }
});

export default router;