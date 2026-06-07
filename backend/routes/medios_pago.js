// routes/medios_pago.js
import express from "express";
import { query } from "../db.js";
import { companyAccess } from "./companyAccess.js";

const router = express.Router();

// ================== HELPERS ==================

function limpiarTexto(value) {
  if (value === null || value === undefined) return null;
  const texto = String(value).trim();
  return texto === "" ? null : texto;
}

/**
 * Convierte valores recibidos desde frontend a boolean real.
 * Esto funciona si la columna en PostgreSQL es boolean.
 * Si la columna fuera varchar, PostgreSQL normalmente castea "true"/"false".
 */
function limpiarBooleano(value, defaultValue = false) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const texto = String(value).trim().toLowerCase();

  if (["true", "1", "si", "sí", "activo", "activa", "en uso", "on"].includes(texto)) {
    return true;
  }

  if (["false", "0", "no", "inactivo", "inactiva", "no en uso", "off"].includes(texto)) {
    return false;
  }

  return null;
}

function normalizarBooleanoSalida(row) {
  if (!row) return row;

  return {
    ...row,
    enuso:
      row.enuso === true ||
      String(row.enuso).trim().toLowerCase() === "true",

    mediopagoelectronico:
      row.mediopagoelectronico === true ||
      String(row.mediopagoelectronico).trim().toLowerCase() === "true",
  };
}

function normalizarListaSalida(rows = []) {
  return rows.map(normalizarBooleanoSalida);
}

/**
 * Expresiones SQL seguras:
 * Funcionan aunque la columna sea boolean o varchar,
 * porque primero se convierte a texto con ::text.
 */
const SQL_ENUSO_BOOL = "LOWER(TRIM(COALESCE(enuso::text, 'false')))";
const SQL_ELECTRONICO_BOOL = "LOWER(TRIM(COALESCE(mediopagoelectronico::text, 'false')))";

/**
 * Esta ruta ya viene protegida desde server.js:
 * app.use("/api/medios", authJwt, mediosRoutes);
 *
 * Aquí solo validamos acceso a empresa.
 */
router.use(companyAccess);

// ================== GET: Listar Medios de Pago ==================
//
// Compatibilidad:
// GET /api/medios
// Devuelve array simple solo con medios en uso.
//
// Administración:
// GET /api/medios?todos=true&paginado=true&page=1&limit=10
// Devuelve objeto con data, pagination y resumen.
//

router.get("/", async (req, res) => {
  try {
    const {
      buscar,
      enuso,
      relacionadocon,
      electronico,
      todos,
      paginado,
      page = 1,
      limit = 10,
    } = req.query;

    const where = ["idempresa = $1"];
    const params = [req.idempresa];

    const usarPaginacion = paginado === "true";

    const currentPage = Math.max(parseInt(page, 10) || 1, 1);
    const currentLimit = Math.max(parseInt(limit, 10) || 10, 1);
    const offset = (currentPage - 1) * currentLimit;

    // Por defecto, para no romper pantallas operativas:
    // GET /api/medios trae solo medios en uso.
    if (todos !== "true") {
      where.push(`${SQL_ENUSO_BOOL} = 'true'`);
    }

    if (buscar && buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      where.push(`
        (
          nombre ILIKE $${params.length}
          OR relacionadocon ILIKE $${params.length}
          OR cuentacontable ILIKE $${params.length}
          OR idsiigo ILIKE $${params.length}
        )
      `);
    }

    if (enuso !== undefined && enuso !== null && String(enuso).trim() !== "") {
      const enusoNormalizado = limpiarBooleano(enuso);

      if (enusoNormalizado === null) {
        return res.status(400).json({
          success: false,
          error: "Valor inválido para enuso. Use true o false.",
        });
      }

      // Quitar filtro por defecto si viene filtro explícito.
      const filtroDefault = `${SQL_ENUSO_BOOL} = 'true'`;
      const indexFiltroEnUso = where.indexOf(filtroDefault);

      if (indexFiltroEnUso >= 0) {
        where.splice(indexFiltroEnUso, 1);
      }

      params.push(String(enusoNormalizado));
      where.push(`${SQL_ENUSO_BOOL} = $${params.length}`);
    }

    if (relacionadocon && relacionadocon.trim()) {
      params.push(relacionadocon.trim());
      where.push(`relacionadocon ILIKE $${params.length}`);
    }

    if (
      electronico !== undefined &&
      electronico !== null &&
      String(electronico).trim() !== ""
    ) {
      const electronicoNormalizado = limpiarBooleano(electronico);

      if (electronicoNormalizado === null) {
        return res.status(400).json({
          success: false,
          error: "Valor inválido para mediopagoelectronico. Use true o false.",
        });
      }

      params.push(String(electronicoNormalizado));
      where.push(`${SQL_ELECTRONICO_BOOL} = $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const totalResult = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.medios_pago
      ${whereSql}
      `,
      params
    );

    const total = totalResult.rows[0]?.total || 0;

    const resumenResult = await query(
      `
      SELECT
        COUNT(*)::int AS total_medios,

        COUNT(*) FILTER (
          WHERE ${SQL_ENUSO_BOOL} = 'true'
        )::int AS total_en_uso,

        COUNT(*) FILTER (
          WHERE ${SQL_ENUSO_BOOL} = 'false'
        )::int AS total_inactivos,

        COUNT(*) FILTER (
          WHERE ${SQL_ELECTRONICO_BOOL} = 'true'
        )::int AS total_electronicos,

        COUNT(*) FILTER (
          WHERE ${SQL_ELECTRONICO_BOOL} = 'false'
        )::int AS total_no_electronicos

      FROM public.medios_pago
      WHERE idempresa = $1
      `,
      [req.idempresa]
    );

    const resumen = resumenResult.rows[0] || {
      total_medios: 0,
      total_en_uso: 0,
      total_inactivos: 0,
      total_electronicos: 0,
      total_no_electronicos: 0,
    };

    let sql = `
      SELECT
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      FROM public.medios_pago
      ${whereSql}
      ORDER BY idmedio ASC
    `;

    const queryParams = [...params];

    if (usarPaginacion) {
      queryParams.push(currentLimit);
      queryParams.push(offset);

      sql += `
        LIMIT $${queryParams.length - 1}
        OFFSET $${queryParams.length}
      `;
    }

    const result = await query(sql, queryParams);
    const dataNormalizada = normalizarListaSalida(result.rows);

    if (usarPaginacion) {
      return res.json({
        success: true,
        data: dataNormalizada,
        pagination: {
          page: currentPage,
          limit: currentLimit,
          total,
          total_pages: Math.ceil(total / currentLimit),
        },
        resumen,
      });
    }

    return res.json(dataNormalizada);
  } catch (error) {
    console.error("❌ Error en GET /medios:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener medios de pago",
    });
  }
});

// ================== GET: Medio de Pago por ID ==================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      FROM public.medios_pago
      WHERE idmedio = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Medio de pago no encontrado",
      });
    }

    return res.json(normalizarBooleanoSalida(result.rows[0]));
  } catch (error) {
    console.error("❌ Error obteniendo medio de pago:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener medio de pago",
    });
  }
});

// ================== POST: Crear Medio de Pago ==================

router.post("/", async (req, res) => {
  try {
    let {
      nombre,
      relacionadocon,
      cuentacontable,
      mediopagoelectronico,
      enuso,
      idsiigo,
    } = req.body;

    nombre = limpiarTexto(nombre);
    relacionadocon = limpiarTexto(relacionadocon);
    cuentacontable = limpiarTexto(cuentacontable);
    mediopagoelectronico = limpiarBooleano(mediopagoelectronico, false);
    enuso = limpiarBooleano(enuso, true);
    idsiigo = limpiarTexto(idsiigo);

    if (!nombre) {
      return res.status(400).json({
        success: false,
        error: "El nombre del medio de pago es obligatorio.",
      });
    }

    if (mediopagoelectronico === null) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido para medio de pago electrónico. Use true o false.",
      });
    }

    if (enuso === null) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido para en uso. Use true o false.",
      });
    }

    // El nombre debe ser único por empresa.
    const existeNombre = await query(
      `
      SELECT idmedio
      FROM public.medios_pago
      WHERE idempresa = $1
        AND UPPER(TRIM(nombre)) = UPPER(TRIM($2))
      LIMIT 1
      `,
      [req.idempresa, nombre]
    );

    if (existeNombre.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Ya existe un medio de pago con este nombre en la empresa activa.",
      });
    }

    const result = await query(
      `
      INSERT INTO public.medios_pago (
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      `,
      [
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        req.idempresa,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Medio de pago creado correctamente",
      medio_pago: normalizarBooleanoSalida(result.rows[0]),
    });
  } catch (error) {
    console.error("❌ Error creando medio de pago:", error);
    return res.status(500).json({
      success: false,
      error: "Error creando medio de pago",
    });
  }
});

// ================== PUT: Actualizar Medio de Pago ==================

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    let {
      nombre,
      relacionadocon,
      cuentacontable,
      mediopagoelectronico,
      enuso,
      idsiigo,
    } = req.body;

    nombre = limpiarTexto(nombre);
    relacionadocon = limpiarTexto(relacionadocon);
    cuentacontable = limpiarTexto(cuentacontable);
    mediopagoelectronico = limpiarBooleano(mediopagoelectronico, false);
    enuso = limpiarBooleano(enuso, true);
    idsiigo = limpiarTexto(idsiigo);

    if (!nombre) {
      return res.status(400).json({
        success: false,
        error: "El nombre del medio de pago es obligatorio.",
      });
    }

    if (mediopagoelectronico === null) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido para medio de pago electrónico. Use true o false.",
      });
    }

    if (enuso === null) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido para en uso. Use true o false.",
      });
    }

    const medioExiste = await query(
      `
      SELECT idmedio
      FROM public.medios_pago
      WHERE idmedio = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [id, req.idempresa]
    );

    if (medioExiste.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Medio de pago no encontrado.",
      });
    }

    // El nombre debe ser único por empresa.
    const existeNombre = await query(
      `
      SELECT idmedio
      FROM public.medios_pago
      WHERE idempresa = $1
        AND UPPER(TRIM(nombre)) = UPPER(TRIM($2))
        AND idmedio <> $3
      LIMIT 1
      `,
      [req.idempresa, nombre, id]
    );

    if (existeNombre.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Ya existe otro medio de pago con este nombre en la empresa activa.",
      });
    }

    const result = await query(
      `
      UPDATE public.medios_pago
      SET
        nombre = $1,
        relacionadocon = $2,
        cuentacontable = $3,
        mediopagoelectronico = $4,
        enuso = $5,
        idsiigo = $6
      WHERE idmedio = $7
        AND idempresa = $8
      RETURNING
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      `,
      [
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        id,
        req.idempresa,
      ]
    );

    return res.json({
      success: true,
      message: "Medio de pago actualizado correctamente",
      medio_pago: normalizarBooleanoSalida(result.rows[0]),
    });
  } catch (error) {
    console.error("❌ Error actualizando medio de pago:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando medio de pago",
    });
  }
});

// ================== PATCH: Activar / Inactivar Medio de Pago ==================

router.patch("/:id/estado", async (req, res) => {
  try {
    const { id } = req.params;
    let { enuso } = req.body;

    enuso = limpiarBooleano(enuso, true);

    if (enuso === null) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido para en uso. Use true o false.",
      });
    }

    const result = await query(
      `
      UPDATE public.medios_pago
      SET enuso = $1
      WHERE idmedio = $2
        AND idempresa = $3
      RETURNING
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      `,
      [enuso, id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Medio de pago no encontrado.",
      });
    }

    return res.json({
      success: true,
      message: "Estado del medio de pago actualizado correctamente",
      medio_pago: normalizarBooleanoSalida(result.rows[0]),
    });
  } catch (error) {
    console.error("❌ Error actualizando estado del medio de pago:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando estado del medio de pago",
    });
  }
});

// ================== PATCH: Marcar / Desmarcar como Electrónico ==================

router.patch("/:id/electronico", async (req, res) => {
  try {
    const { id } = req.params;
    let { mediopagoelectronico } = req.body;

    mediopagoelectronico = limpiarBooleano(mediopagoelectronico, false);

    if (mediopagoelectronico === null) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido para medio de pago electrónico. Use true o false.",
      });
    }

    const result = await query(
      `
      UPDATE public.medios_pago
      SET mediopagoelectronico = $1
      WHERE idmedio = $2
        AND idempresa = $3
      RETURNING
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      `,
      [mediopagoelectronico, id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Medio de pago no encontrado.",
      });
    }

    return res.json({
      success: true,
      message: "Configuración electrónica del medio de pago actualizada correctamente",
      medio_pago: normalizarBooleanoSalida(result.rows[0]),
    });
  } catch (error) {
    console.error("❌ Error actualizando medio de pago electrónico:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando medio de pago electrónico",
    });
  }
});

// ================== DELETE: Eliminar Medio de Pago ==================
//
// Recomendación:
// En producción es mejor inactivar que eliminar.
// Si el medio de pago tiene facturas, pagos u otros registros relacionados,
// PostgreSQL puede bloquearlo por llaves foráneas.
//

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      DELETE FROM public.medios_pago
      WHERE idmedio = $1
        AND idempresa = $2
      RETURNING
        idmedio,
        nombre,
        relacionadocon,
        cuentacontable,
        mediopagoelectronico,
        enuso,
        idsiigo,
        idempresa
      `,
      [id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Medio de pago no encontrado.",
      });
    }

    return res.json({
      success: true,
      message: "Medio de pago eliminado correctamente",
      medio_pago: normalizarBooleanoSalida(result.rows[0]),
    });
  } catch (error) {
    console.error("❌ Error eliminando medio de pago:", error);

    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        error:
          "No se puede eliminar el medio de pago porque tiene registros relacionados. Se recomienda inactivarlo.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Error eliminando medio de pago",
    });
  }
});

export default router;