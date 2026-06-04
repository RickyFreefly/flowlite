// routes/energia.js
import express from "express";
import { query } from "../db.js";

const router = express.Router();

/**
 * Factor de conversión para TOTAL GENERAL.
 *
 * Regla:
 * - Solo Total General se multiplica por 760.
 * - Gravity NO se multiplica.
 * - Zona Cero NO se multiplica.
 */
const FACTOR_TOTAL_GENERAL = Number(process.env.ENERGIA_FACTOR_TOTAL_GENERAL || 760);

/**
 * Helper: convertir a número seguro
 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Helper: convertir lectura de Total General.
 * Solo este campo se multiplica por 760.
 */
function convertirTotalGeneral(value) {
  const base = toNumber(value);
  return base === null ? null : base * FACTOR_TOTAL_GENERAL;
}

/**
 * Helper: validar fecha YYYY-MM-DD
 */
function isValidDateString(value) {
  if (!value || typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Helper: obtener usuario autenticado
 */
function getAuthUserId(req) {
  return req.user?.idusuario || null;
}

/**
 * ==========================================
 * GET: Listar registros de energía
 * Soporta:
 * /api/energia/registros
 * /api/energia/registros?fecha_inicio=2026-05-01&fecha_fin=2026-05-31
 * /api/energia/registros?estado=CERRADO
 * ==========================================
 */
router.get("/registros", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, estado } = req.query;

    const where = [];
    const params = [];

    if (fecha_inicio && fecha_fin) {
      params.push(fecha_inicio);
      params.push(fecha_fin);
      where.push(
        `e.fecha >= $${params.length - 1}::date AND e.fecha < ($${params.length}::date + INTERVAL '1 day')`
      );
    }

    if (estado && String(estado).trim()) {
      params.push(String(estado).trim().toUpperCase());
      where.push(`e.estado = $${params.length}`);
    }

    const sql = `
      SELECT
        e.idenergia_registro,
        e.fecha,

        e.lectura_inicial_total,
        e.lectura_final_total,
        e.lectura_inicial_gravity,
        e.lectura_final_gravity,
        e.lectura_inicial_zona_cero,
        e.lectura_final_zona_cero,

        e.valor_kwh,

        e.consumo_total_kwh,
        e.consumo_gravity_kwh,
        e.consumo_zona_cero_kwh,
        e.consumo_identificado_kwh,
        e.consumo_restante_kwh,

        e.costo_total,
        e.costo_gravity,
        e.costo_zona_cero,
        e.costo_identificado,
        e.costo_restante,

        e.estado,
        e.observaciones,
        e.createdat,
        e.updatedat,
        e.createdby,
        u.username AS usuario
      FROM energia_registros_diarios e
      LEFT JOIN usuarios u ON u.idusuario = e.createdby
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY e.fecha DESC, e.idenergia_registro DESC
    `;

    const result = await query(sql, params);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error listando registros de energía:", error);
    res.status(500).json({ error: "Error al obtener registros de energía" });
  }
});

/**
 * ==========================================
 * GET: Obtener registro por ID
 * ==========================================
 */
router.get("/registros/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT
        e.*,
        u.username AS usuario
      FROM energia_registros_diarios e
      LEFT JOIN usuarios u ON u.idusuario = e.createdby
      WHERE e.idenergia_registro = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Registro de energía no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo registro de energía:", error);
    res.status(500).json({ error: "Error al obtener registro de energía" });
  }
});

/**
 * ==========================================
 * POST: Abrir día
 * ==========================================
 */
router.post("/abrir-dia", async (req, res) => {
  try {
    const idusuario = getAuthUserId(req);

    if (!idusuario) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const {
      fecha,
      lectura_inicial_total,
      lectura_inicial_gravity,
      lectura_inicial_zona_cero,
      valor_kwh,
      observaciones,
    } = req.body;

    if (!isValidDateString(fecha)) {
      return res.status(400).json({
        error: "La fecha es obligatoria y debe tener formato YYYY-MM-DD",
      });
    }

    /**
     * IMPORTANTE:
     * Solo Total General se multiplica por FACTOR_TOTAL_GENERAL.
     */
    const inicialTotal = convertirTotalGeneral(lectura_inicial_total);

    /**
     * Gravity y Zona Cero quedan sin multiplicar.
     */
    const inicialGravity = toNumber(lectura_inicial_gravity);
    const inicialZonaCero = toNumber(lectura_inicial_zona_cero);

    const valorKwh =
      valor_kwh === undefined || valor_kwh === null || valor_kwh === ""
        ? 1000
        : toNumber(valor_kwh);

    if (inicialTotal === null || inicialGravity === null || inicialZonaCero === null) {
      return res.status(400).json({
        error: "Las lecturas iniciales son obligatorias y deben ser numéricas",
      });
    }

    if (inicialTotal < 0 || inicialGravity < 0 || inicialZonaCero < 0) {
      return res.status(400).json({
        error: "Las lecturas iniciales no pueden ser negativas",
      });
    }

    if (valorKwh === null || valorKwh <= 0) {
      return res.status(400).json({
        error: "El valor del kWh debe ser mayor a cero",
      });
    }

    const existe = await query(
      `
      SELECT idenergia_registro, estado
      FROM energia_registros_diarios
      WHERE fecha = $1::date
      `,
      [fecha]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({
        error: "Ya existe un registro de energía para esta fecha",
        registro: existe.rows[0],
      });
    }

    const result = await query(
      `
      INSERT INTO energia_registros_diarios (
        fecha,
        lectura_inicial_total,
        lectura_inicial_gravity,
        lectura_inicial_zona_cero,
        valor_kwh,
        estado,
        observaciones,
        createdat,
        updatedat,
        createdby
      )
      VALUES ($1, $2, $3, $4, $5, 'ABIERTO', $6, NOW(), NOW(), $7)
      RETURNING *
      `,
      [
        fecha,
        inicialTotal,
        inicialGravity,
        inicialZonaCero,
        valorKwh,
        observaciones || null,
        idusuario,
      ]
    );

    res.status(201).json({
      message: "Día de energía abierto correctamente",
      factor_total_general: FACTOR_TOTAL_GENERAL,
      registro: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error abriendo día de energía:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Ya existe un registro de energía para esta fecha",
      });
    }

    res.status(500).json({ error: "Error abriendo día de energía" });
  }
});

/**
 * ==========================================
 * PUT: Cerrar día
 * ==========================================
 */
router.put("/:id/cerrar-dia", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      lectura_final_total,
      lectura_final_gravity,
      lectura_final_zona_cero,
      observaciones,
    } = req.body;

    /**
     * IMPORTANTE:
     * Solo Total General se multiplica por FACTOR_TOTAL_GENERAL.
     */
    const finalTotal = convertirTotalGeneral(lectura_final_total);

    /**
     * Gravity y Zona Cero quedan sin multiplicar.
     */
    const finalGravity = toNumber(lectura_final_gravity);
    const finalZonaCero = toNumber(lectura_final_zona_cero);

    if (finalTotal === null || finalGravity === null || finalZonaCero === null) {
      return res.status(400).json({
        error: "Las lecturas finales son obligatorias y deben ser numéricas",
      });
    }

    const actualResult = await query(
      `
      SELECT *
      FROM energia_registros_diarios
      WHERE idenergia_registro = $1
      `,
      [id]
    );

    if (actualResult.rows.length === 0) {
      return res.status(404).json({
        error: "Registro de energía no encontrado",
      });
    }

    const actual = actualResult.rows[0];

    if (actual.estado === "ANULADO") {
      return res.status(400).json({
        error: "No se puede cerrar un registro anulado",
      });
    }

    if (actual.estado === "CERRADO") {
      return res.status(400).json({
        error: "Este registro ya está cerrado",
      });
    }

    const inicialTotal = Number(actual.lectura_inicial_total);
    const inicialGravity = Number(actual.lectura_inicial_gravity);
    const inicialZonaCero = Number(actual.lectura_inicial_zona_cero);

    if (finalTotal < inicialTotal) {
      return res.status(400).json({
        error: "La lectura final total no puede ser menor que la lectura inicial total",
      });
    }

    if (finalGravity < inicialGravity) {
      return res.status(400).json({
        error: "La lectura final de Gravity no puede ser menor que la lectura inicial de Gravity",
      });
    }

    if (finalZonaCero < inicialZonaCero) {
      return res.status(400).json({
        error: "La lectura final de Zona Cero no puede ser menor que la lectura inicial de Zona Cero",
      });
    }

    const consumoTotal = finalTotal - inicialTotal;
    const consumoGravity = finalGravity - inicialGravity;
    const consumoZonaCero = finalZonaCero - inicialZonaCero;
    const consumoIdentificado = consumoGravity + consumoZonaCero;

    if (consumoIdentificado > consumoTotal) {
      return res.status(400).json({
        error: "El consumo de Gravity más Zona Cero no puede superar el consumo total",
        detalle: {
          factor_total_general: FACTOR_TOTAL_GENERAL,
          consumo_total_kwh: consumoTotal,
          consumo_gravity_kwh: consumoGravity,
          consumo_zona_cero_kwh: consumoZonaCero,
          consumo_identificado_kwh: consumoIdentificado,
          diferencia_kwh: consumoTotal - consumoIdentificado,
        },
      });
    }

    const observacionFinal = observaciones
      ? `${actual.observaciones || ""}${actual.observaciones ? " | " : ""}${observaciones}`
      : actual.observaciones;

    const result = await query(
      `
      UPDATE energia_registros_diarios
      SET
        lectura_final_total = $1,
        lectura_final_gravity = $2,
        lectura_final_zona_cero = $3,
        estado = 'CERRADO',
        observaciones = $4,
        updatedat = NOW()
      WHERE idenergia_registro = $5
      RETURNING *
      `,
      [
        finalTotal,
        finalGravity,
        finalZonaCero,
        observacionFinal || null,
        id,
      ]
    );

    res.json({
      message: "Día de energía cerrado correctamente",
      factor_total_general: FACTOR_TOTAL_GENERAL,
      registro: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error cerrando día de energía:", error);

    if (error.code === "23514") {
      return res.status(400).json({
        error: "Las lecturas no cumplen las validaciones de consumo",
      });
    }

    res.status(500).json({ error: "Error cerrando día de energía" });
  }
});

/**
 * ==========================================
 * PUT: Editar registro
 * Solo permite editar registros ABIERTO.
 * ==========================================
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      fecha,
      lectura_inicial_total,
      lectura_inicial_gravity,
      lectura_inicial_zona_cero,
      valor_kwh,
      observaciones,
    } = req.body;

    const actualResult = await query(
      `
      SELECT *
      FROM energia_registros_diarios
      WHERE idenergia_registro = $1
      `,
      [id]
    );

    if (actualResult.rows.length === 0) {
      return res.status(404).json({
        error: "Registro de energía no encontrado",
      });
    }

    const actual = actualResult.rows[0];

    if (actual.estado !== "ABIERTO") {
      return res.status(400).json({
        error: "Solo se pueden editar registros en estado ABIERTO",
      });
    }

    if (fecha && !isValidDateString(fecha)) {
      return res.status(400).json({
        error: "La fecha debe tener formato YYYY-MM-DD",
      });
    }

    /**
     * IMPORTANTE:
     * Si viene lectura_inicial_total desde el request,
     * se multiplica por FACTOR_TOTAL_GENERAL.
     * Si no viene, se conserva el valor ya almacenado.
     */
    const inicialTotal =
      lectura_inicial_total !== undefined
        ? convertirTotalGeneral(lectura_inicial_total)
        : Number(actual.lectura_inicial_total);

    /**
     * Gravity y Zona Cero quedan sin multiplicar.
     */
    const inicialGravity =
      lectura_inicial_gravity !== undefined
        ? toNumber(lectura_inicial_gravity)
        : Number(actual.lectura_inicial_gravity);

    const inicialZonaCero =
      lectura_inicial_zona_cero !== undefined
        ? toNumber(lectura_inicial_zona_cero)
        : Number(actual.lectura_inicial_zona_cero);

    const valorKwh =
      valor_kwh !== undefined
        ? toNumber(valor_kwh)
        : Number(actual.valor_kwh);

    if (
      inicialTotal === null ||
      inicialGravity === null ||
      inicialZonaCero === null ||
      valorKwh === null
    ) {
      return res.status(400).json({
        error: "Los valores enviados deben ser numéricos",
      });
    }

    if (inicialTotal < 0 || inicialGravity < 0 || inicialZonaCero < 0) {
      return res.status(400).json({
        error: "Las lecturas iniciales no pueden ser negativas",
      });
    }

    if (valorKwh <= 0) {
      return res.status(400).json({
        error: "El valor del kWh debe ser mayor a cero",
      });
    }

    const result = await query(
      `
      UPDATE energia_registros_diarios
      SET
        fecha = COALESCE($1::date, fecha),
        lectura_inicial_total = $2,
        lectura_inicial_gravity = $3,
        lectura_inicial_zona_cero = $4,
        valor_kwh = $5,
        observaciones = $6,
        updatedat = NOW()
      WHERE idenergia_registro = $7
      RETURNING *
      `,
      [
        fecha || null,
        inicialTotal,
        inicialGravity,
        inicialZonaCero,
        valorKwh,
        observaciones !== undefined ? observaciones : actual.observaciones,
        id,
      ]
    );

    res.json({
      message: "Registro de energía actualizado correctamente",
      factor_total_general: FACTOR_TOTAL_GENERAL,
      registro: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error actualizando registro de energía:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Ya existe un registro de energía para esta fecha",
      });
    }

    res.status(500).json({ error: "Error actualizando registro de energía" });
  }
});

/**
 * ==========================================
 * PATCH: Anular registro
 * ==========================================
 */
router.patch("/:id/anular", async (req, res) => {
  try {
    const { id } = req.params;
    const { observaciones } = req.body;

    const result = await query(
      `
      UPDATE energia_registros_diarios
      SET
        estado = 'ANULADO',
        observaciones = CONCAT(
          COALESCE(observaciones, ''),
          CASE WHEN COALESCE(observaciones, '') = '' THEN '' ELSE ' | ' END,
          $1::text
        ),
        updatedat = NOW()
      WHERE idenergia_registro = $2
      RETURNING *
      `,
      [observaciones || "Registro anulado", id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Registro de energía no encontrado",
      });
    }

    res.json({
      message: "Registro de energía anulado correctamente",
      registro: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error anulando registro de energía:", error);
    res.status(500).json({ error: "Error anulando registro de energía" });
  }
});

/**
 * ==========================================
 * GET: Resumen de energía por periodo
 * /api/energia/resumen?fecha_inicio=2026-05-01&fecha_fin=2026-05-31
 * ==========================================
 */
router.get("/resumen", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: "fecha_inicio y fecha_fin son obligatorios. Formato: YYYY-MM-DD",
      });
    }

    if (!isValidDateString(fecha_inicio) || !isValidDateString(fecha_fin)) {
      return res.status(400).json({
        error: "Las fechas deben tener formato YYYY-MM-DD",
      });
    }

    const sql = `
      WITH base AS (
        SELECT *
        FROM energia_registros_diarios
        WHERE fecha >= $1::date
          AND fecha < ($2::date + INTERVAL '1 day')
          AND estado = 'CERRADO'
      ),
      resumen AS (
        SELECT
          COUNT(*)::int AS dias_cerrados,

          COALESCE(SUM(consumo_total_kwh), 0) AS consumo_total_kwh,
          COALESCE(SUM(consumo_gravity_kwh), 0) AS consumo_gravity_kwh,
          COALESCE(SUM(consumo_zona_cero_kwh), 0) AS consumo_zona_cero_kwh,
          COALESCE(SUM(consumo_identificado_kwh), 0) AS consumo_identificado_kwh,
          COALESCE(SUM(consumo_restante_kwh), 0) AS consumo_restante_kwh,

          COALESCE(SUM(costo_total), 0) AS costo_total,
          COALESCE(SUM(costo_gravity), 0) AS costo_gravity,
          COALESCE(SUM(costo_zona_cero), 0) AS costo_zona_cero,
          COALESCE(SUM(costo_identificado), 0) AS costo_identificado,
          COALESCE(SUM(costo_restante), 0) AS costo_restante,

          COALESCE(AVG(valor_kwh), 1000) AS valor_kwh_promedio
        FROM base
      )
      SELECT
        r.*,

        CASE 
          WHEN r.dias_cerrados = 0 THEN 0
          ELSE ROUND((r.consumo_total_kwh / r.dias_cerrados)::numeric, 3)
        END AS promedio_diario_kwh,

        (
          ($2::date - $1::date) + 1
        )::int AS dias_periodo,

        CASE 
          WHEN r.dias_cerrados = 0 THEN 0
          ELSE ROUND(
            (
              (r.consumo_total_kwh / r.dias_cerrados)
              *
              ((DATE_TRUNC('month', $1::date) + INTERVAL '1 month - 1 day')::date - DATE_TRUNC('month', $1::date)::date + 1)
            )::numeric,
            3
          )
        END AS proyeccion_mes_kwh,

        CASE 
          WHEN r.dias_cerrados = 0 THEN 0
          ELSE ROUND(
            (
              (r.consumo_total_kwh / r.dias_cerrados)
              *
              ((DATE_TRUNC('month', $1::date) + INTERVAL '1 month - 1 day')::date - DATE_TRUNC('month', $1::date)::date + 1)
              *
              r.valor_kwh_promedio
            )::numeric,
            2
          )
        END AS proyeccion_mes_costo

      FROM resumen r
    `;

    const result = await query(sql, [fecha_inicio, fecha_fin]);

    res.json({
      fecha_inicio,
      fecha_fin,
      resumen: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error generando resumen de energía:", error);
    res.status(500).json({ error: "Error generando resumen de energía" });
  }
});

export default router;