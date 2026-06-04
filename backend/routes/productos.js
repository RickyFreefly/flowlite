// routes/productos.js
import express from "express";
import { query } from "../db.js";
import { authJwt } from "./authJwt.js";
import { companyAccess } from "./companyAccess.js";

const router = express.Router();

// ================== HELPERS ==================

function limpiarTexto(value) {
  if (value === null || value === undefined) return null;
  const texto = String(value).trim();
  return texto === "" ? null : texto;
}

function limpiarNumero(value) {
  if (value === null || value === undefined || value === "") return null;

  const numero = Number(value);

  if (Number.isNaN(numero)) {
    return NaN;
  }

  return numero;
}

const ESTADOS_PERMITIDOS = ["Activo", "Inactivo"];
const TIPOS_PERMITIDOS = ["Servicio", "Producto", "Paquete"];

/**
 * Todas las rutas de productos quedan protegidas por:
 * 1. authJwt: valida el usuario autenticado.
 * 2. companyAccess: valida que el usuario tenga acceso a la empresa enviada en x-empresa-id.
 */
router.use(authJwt, companyAccess);

// ================== GET: Listar Productos ==================
//
// Compatibilidad:
// GET /api/productos
// Devuelve array simple solo con activos.
//
// Administración:
// GET /api/productos?todos=true&paginado=true&page=1&limit=10
// Devuelve objeto con data, pagination y resumen.
//
router.get("/", async (req, res) => {
  try {
    const {
      buscar,
      estado,
      tipo,
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

    // Por defecto, para no romper facturas/reservas:
    // GET /api/productos sigue trayendo solo activos.
    if (todos !== "true") {
      where.push(`UPPER(TRIM(estado)) = 'ACTIVO'`);
    }

    if (buscar && buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      where.push(`
        (
          codigo ILIKE $${params.length}
          OR nombre ILIKE $${params.length}
        )
      `);
    }

    if (estado && estado.trim()) {
      const estadoNormalizado = estado.trim().toUpperCase();

      if (!["ACTIVO", "INACTIVO"].includes(estadoNormalizado)) {
        return res.status(400).json({
          success: false,
          error: "Estado inválido. Use Activo o Inactivo.",
        });
      }

      // Quitar filtro por defecto si viene filtro explícito.
      const indexFiltroActivo = where.indexOf(`UPPER(TRIM(estado)) = 'ACTIVO'`);
      if (indexFiltroActivo >= 0) {
        where.splice(indexFiltroActivo, 1);
      }

      params.push(estadoNormalizado);
      where.push(`UPPER(TRIM(estado)) = $${params.length}`);
    }

    if (tipo && tipo.trim()) {
      params.push(tipo.trim());
      where.push(`tipo ILIKE $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    // Total filtrado por empresa
    const totalResult = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.productos
      ${whereSql}
      `,
      params
    );

    const total = totalResult.rows[0]?.total || 0;

    // Resumen global por empresa para tarjetas
    const resumenResult = await query(
      `
      SELECT
        COUNT(*)::int AS total_productos,
        COUNT(*) FILTER (WHERE UPPER(TRIM(estado)) = 'ACTIVO')::int AS total_activos,
        COUNT(*) FILTER (WHERE UPPER(TRIM(estado)) = 'INACTIVO')::int AS total_inactivos
      FROM public.productos
      WHERE idempresa = $1
      `,
      [req.idempresa]
    );

    const resumen = resumenResult.rows[0] || {
      total_productos: 0,
      total_activos: 0,
      total_inactivos: 0,
    };

    let sql = `
      SELECT 
        idproducto,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        idempresa
      FROM public.productos
      ${whereSql}
      ORDER BY idproducto ASC
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

    // Modo administración con paginación
    if (usarPaginacion) {
      return res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: currentPage,
          limit: currentLimit,
          total,
          total_pages: Math.ceil(total / currentLimit),
        },
        resumen,
      });
    }

    // Modo antiguo: array simple
    return res.json(result.rows);
  } catch (error) {
    console.error("❌ Error en GET /productos:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener productos",
    });
  }
});

// ================== GET: Producto por ID ==================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT 
        idproducto,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        idempresa
      FROM public.productos
      WHERE idproducto = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Producto no encontrado",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo producto:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener producto",
    });
  }
});

// ================== POST: Crear Producto ==================

router.post("/", async (req, res) => {
  try {
    let {
      codigo,
      nombre,
      tipo,
      unidad,
      precio,
      impuestos,
      estado,
    } = req.body;

    codigo = limpiarTexto(codigo);
    nombre = limpiarTexto(nombre);
    tipo = limpiarTexto(tipo);
    unidad = limpiarTexto(unidad);
    precio = limpiarNumero(precio);
    impuestos = limpiarNumero(impuestos);
    estado = limpiarTexto(estado) || "Activo";

    if (!codigo || !nombre || !tipo || !unidad) {
      return res.status(400).json({
        success: false,
        error: "Código, nombre, tipo y unidad son obligatorios.",
      });
    }

    if (!TIPOS_PERMITIDOS.includes(tipo)) {
      return res.status(400).json({
        success: false,
        error: "Tipo inválido. Use Servicio, Producto o Paquete.",
      });
    }

    if (!ESTADOS_PERMITIDOS.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: "Estado inválido. Use Activo o Inactivo.",
      });
    }

    if (precio === null || Number.isNaN(precio) || precio < 0) {
      return res.status(400).json({
        success: false,
        error: "El precio debe ser un número válido mayor o igual a cero.",
      });
    }

    if (impuestos === null || Number.isNaN(impuestos) || impuestos < 0) {
      return res.status(400).json({
        success: false,
        error: "El impuesto debe ser un número válido mayor o igual a cero.",
      });
    }

    // El código debe ser único solo dentro de la empresa activa
    const existeCodigo = await query(
      `
      SELECT idproducto
      FROM public.productos
      WHERE idempresa = $1
        AND codigo = $2
      LIMIT 1
      `,
      [req.idempresa, codigo]
    );

    if (existeCodigo.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Ya existe un producto con este código en la empresa activa.",
      });
    }

    const result = await query(
      `
      INSERT INTO public.productos (
        idempresa,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        idproducto,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        idempresa
      `,
      [
        req.idempresa,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Producto creado correctamente",
      producto: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error creando producto:", error);
    return res.status(500).json({
      success: false,
      error: "Error creando producto",
    });
  }
});

// ================== PUT: Actualizar Producto ==================

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    let {
      codigo,
      nombre,
      tipo,
      unidad,
      precio,
      impuestos,
      estado,
    } = req.body;

    codigo = limpiarTexto(codigo);
    nombre = limpiarTexto(nombre);
    tipo = limpiarTexto(tipo);
    unidad = limpiarTexto(unidad);
    precio = limpiarNumero(precio);
    impuestos = limpiarNumero(impuestos);
    estado = limpiarTexto(estado);

    if (!codigo || !nombre || !tipo || !unidad || !estado) {
      return res.status(400).json({
        success: false,
        error: "Código, nombre, tipo, unidad y estado son obligatorios.",
      });
    }

    if (!TIPOS_PERMITIDOS.includes(tipo)) {
      return res.status(400).json({
        success: false,
        error: "Tipo inválido. Use Servicio, Producto o Paquete.",
      });
    }

    if (!ESTADOS_PERMITIDOS.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: "Estado inválido. Use Activo o Inactivo.",
      });
    }

    if (precio === null || Number.isNaN(precio) || precio < 0) {
      return res.status(400).json({
        success: false,
        error: "El precio debe ser un número válido mayor o igual a cero.",
      });
    }

    if (impuestos === null || Number.isNaN(impuestos) || impuestos < 0) {
      return res.status(400).json({
        success: false,
        error: "El impuesto debe ser un número válido mayor o igual a cero.",
      });
    }

    const productoExiste = await query(
      `
      SELECT idproducto
      FROM public.productos
      WHERE idproducto = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [id, req.idempresa]
    );

    if (productoExiste.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Producto no encontrado.",
      });
    }

    // El código debe ser único solo dentro de la empresa activa
    const existeCodigo = await query(
      `
      SELECT idproducto
      FROM public.productos
      WHERE idempresa = $1
        AND codigo = $2
        AND idproducto <> $3
      LIMIT 1
      `,
      [req.idempresa, codigo, id]
    );

    if (existeCodigo.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Ya existe otro producto con este código en la empresa activa.",
      });
    }

    const result = await query(
      `
      UPDATE public.productos
      SET
        codigo = $1,
        nombre = $2,
        tipo = $3,
        unidad = $4,
        precio = $5,
        impuestos = $6,
        estado = $7
      WHERE idproducto = $8
        AND idempresa = $9
      RETURNING
        idproducto,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        idempresa
      `,
      [
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        id,
        req.idempresa,
      ]
    );

    return res.json({
      success: true,
      message: "Producto actualizado correctamente",
      producto: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error actualizando producto:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando producto",
    });
  }
});

// ================== PATCH: Activar / Inactivar Producto ==================

router.patch("/:id/estado", async (req, res) => {
  try {
    const { id } = req.params;
    let { estado } = req.body;

    estado = limpiarTexto(estado);

    if (!ESTADOS_PERMITIDOS.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: "Estado inválido. Use Activo o Inactivo.",
      });
    }

    const result = await query(
      `
      UPDATE public.productos
      SET estado = $1
      WHERE idproducto = $2
        AND idempresa = $3
      RETURNING
        idproducto,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        idempresa
      `,
      [estado, id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Producto no encontrado.",
      });
    }

    return res.json({
      success: true,
      message: "Estado del producto actualizado correctamente",
      producto: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error actualizando estado del producto:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando estado del producto",
    });
  }
});

// ================== DELETE: Eliminar Producto ==================
//
// Recomendación:
// En producción es mejor inactivar que eliminar.
// Este endpoint queda disponible, pero si el producto tiene facturas,
// reservas u otros registros relacionados, PostgreSQL puede bloquearlo.
//

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      DELETE FROM public.productos
      WHERE idproducto = $1
        AND idempresa = $2
      RETURNING
        idproducto,
        codigo,
        nombre,
        tipo,
        unidad,
        precio,
        impuestos,
        estado,
        idempresa
      `,
      [id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Producto no encontrado.",
      });
    }

    return res.json({
      success: true,
      message: "Producto eliminado correctamente",
      producto: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error eliminando producto:", error);

    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        error:
          "No se puede eliminar el producto porque tiene registros relacionados. Se recomienda inactivarlo.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Error eliminando producto",
    });
  }
});

export default router;