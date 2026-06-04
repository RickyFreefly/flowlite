// routes/reservas.js
import express from "express";
import { query } from "../db.js";
import { authJwt } from "./authJwt.js";
import { companyAccess } from "./companyAccess.js";

const router = express.Router();

/**
 * Todas las rutas de reservas quedan protegidas por:
 * 1. authJwt: valida el usuario autenticado.
 * 2. companyAccess: valida que el usuario tenga acceso a la empresa enviada en x-empresa-id.
 */
router.use(authJwt, companyAccess);

// ================== POST: Crear Reserva ==================
router.post("/", async (req, res) => {
  try {
    const {
      idcliente,
      idproducto,
      valorreserva,
      idmedio,
      observaciones
    } = req.body;

    if (!idcliente || !idproducto || !valorreserva || !idmedio) {
      return res.status(400).json({
        success: false,
        error: "Faltan campos obligatorios"
      });
    }

    // Validar que el cliente pertenezca a la empresa activa
    const clienteCheck = await query(
      `
      SELECT idcliente
      FROM public.clientes
      WHERE idcliente = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [idcliente, req.idempresa]
    );

    if (clienteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa"
      });
    }

    // Validar que el producto pertenezca a la empresa activa
    const productoCheck = await query(
      `
      SELECT idproducto
      FROM public.productos
      WHERE idproducto = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [idproducto, req.idempresa]
    );

    if (productoCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Producto no encontrado para la empresa activa"
      });
    }

    // Validar que el medio de pago pertenezca a la empresa activa
    const medioCheck = await query(
      `
      SELECT idmedio
      FROM public.medios_pago
      WHERE idmedio = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [idmedio, req.idempresa]
    );

    if (medioCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Medio de pago no encontrado para la empresa activa"
      });
    }

    const result = await query(
      `
      INSERT INTO public.reservas (
        idempresa,
        idcliente,
        idproducto,
        valorreserva,
        idmedio,
        idusuario,
        estado,
        createdat,
        updatedat
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'RESERVADO', NOW(), NOW())
      RETURNING *
      `,
      [
        req.idempresa,
        idcliente,
        idproducto,
        valorreserva,
        idmedio,
        req.user.idusuario
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Reserva creada",
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Error creando reserva:", error);
    return res.status(500).json({
      success: false,
      error: "Error creando reserva"
    });
  }
});

// ================== PATCH: Actualizar Estado ==================
router.patch("/:id/estado", async (req, res) => {
  try {
    const { estado } = req.body;
    const { id } = req.params;

    if (!["RESERVADO", "FACTURADO", "CANCELADO"].includes(estado)) {
      return res.status(400).json({
        success: false,
        error: "Estado inválido"
      });
    }

    const result = await query(
      `
      UPDATE public.reservas
      SET estado = $1,
          updatedat = NOW()
      WHERE idreserva = $2
        AND idempresa = $3
      RETURNING *
      `,
      [estado, id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reserva no encontrada"
      });
    }

    return res.json({
      success: true,
      message: "Estado actualizado",
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Error actualizando estado de reserva:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando estado"
    });
  }
});

// ================== GET: Listar Reservas ==================
router.get("/", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    let sql = `
      SELECT 
        r.idreserva AS id,
        r.idreserva,
        r.idempresa,
        r.createdat::date AS fecha,
        r.createdat,
        r.updatedat,
        r.idcliente,
        r.idproducto,
        r.idmedio,
        r.idusuario,
        CASE 
          WHEN c.razonsocial IS NOT NULL AND c.razonsocial <> '' 
            THEN c.razonsocial
          ELSE TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        END AS cliente,
        c.identificacion,
        c.email,
        c.telefono,
        p.nombre AS producto,
        r.valorreserva AS valor,
        r.valorreserva,
        r.estado,
        m.nombre AS medio
      FROM public.reservas r
      JOIN public.clientes c 
        ON c.idcliente = r.idcliente
       AND c.idempresa = r.idempresa
      JOIN public.productos p 
        ON p.idproducto = r.idproducto
       AND p.idempresa = r.idempresa
      JOIN public.medios_pago m 
        ON m.idmedio = r.idmedio
       AND m.idempresa = r.idempresa
      WHERE r.idempresa = $1
    `;

    const params = [req.idempresa];

    if (fecha_inicio && fecha_fin) {
      params.push(fecha_inicio, fecha_fin);
      sql += ` AND r.createdat::date BETWEEN $${params.length - 1} AND $${params.length} `;
    } else if (fecha_inicio) {
      params.push(fecha_inicio);
      sql += ` AND r.createdat::date >= $${params.length} `;
    } else if (fecha_fin) {
      params.push(fecha_fin);
      sql += ` AND r.createdat::date <= $${params.length} `;
    }

    sql += ` ORDER BY r.createdat DESC`;

    const result = await query(sql, params);

    return res.json(result.rows);
  } catch (error) {
    console.error("❌ Error listando reservas:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener reservas"
    });
  }
});

// ================== GET: Reservas por identificación ==================
router.get("/cliente/:identificacion", async (req, res) => {
  try {
    const { identificacion } = req.params;

    const result = await query(
      `
      SELECT 
        r.idreserva AS id,
        r.idreserva,
        r.idempresa,
        c.idcliente,
        c.identificacion,
        CASE 
          WHEN c.razonsocial IS NOT NULL AND c.razonsocial <> '' 
            THEN c.razonsocial
          ELSE TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        END AS nombre_cliente,
        c.email,
        c.telefono,
        r.valorreserva AS abono,
        r.valorreserva,
        r.idproducto,
        p.nombre AS producto,
        p.precio,
        m.idmedio,
        m.nombre AS medio,
        r.estado,
        r.createdat
      FROM public.reservas r
      JOIN public.clientes c 
        ON c.idcliente = r.idcliente
       AND c.idempresa = r.idempresa
      JOIN public.productos p 
        ON p.idproducto = r.idproducto
       AND p.idempresa = r.idempresa
      JOIN public.medios_pago m 
        ON m.idmedio = r.idmedio
       AND m.idempresa = r.idempresa
      WHERE r.idempresa = $1
        AND c.identificacion = $2
        AND r.estado = 'RESERVADO'
      ORDER BY r.createdat DESC
      `,
      [req.idempresa, identificacion]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No se encontraron reservas en estado RESERVADO para este cliente"
      });
    }

    return res.json(result.rows);
  } catch (error) {
    console.error("❌ Error consultando reservas por identificación:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener reservas"
    });
  }
});

// ================== GET: Reserva por ID ==================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT 
        r.idreserva AS id,
        r.idreserva,
        r.idempresa,
        c.idcliente,
        c.identificacion,
        CASE 
          WHEN c.razonsocial IS NOT NULL AND c.razonsocial <> '' 
            THEN c.razonsocial
          ELSE TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        END AS nombre_cliente,
        c.email,
        c.telefono,
        r.valorreserva AS abono,
        r.valorreserva,
        r.idproducto,
        p.nombre AS producto,
        p.precio,
        m.idmedio,
        m.nombre AS medio,
        r.estado,
        r.createdat
      FROM public.reservas r
      JOIN public.clientes c 
        ON c.idcliente = r.idcliente
       AND c.idempresa = r.idempresa
      JOIN public.productos p 
        ON p.idproducto = r.idproducto
       AND p.idempresa = r.idempresa
      JOIN public.medios_pago m 
        ON m.idmedio = r.idmedio
       AND m.idempresa = r.idempresa
      WHERE r.idempresa = $1
        AND r.idreserva = $2
        AND r.estado = 'RESERVADO'
      ORDER BY r.createdat DESC
      LIMIT 1
      `,
      [req.idempresa, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reserva no encontrada"
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo reserva:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener reserva"
    });
  }
});

// ================== PATCH: Facturar Reserva ==================
router.patch("/:id/facturar", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      UPDATE public.reservas
      SET estado = 'FACTURADO',
          updatedat = NOW()
      WHERE idreserva = $1
        AND idempresa = $2
      RETURNING *
      `,
      [id, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reserva no encontrada"
      });
    }

    return res.json({
      success: true,
      message: "Reserva actualizada a FACTURADO",
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Error facturando reserva:", error);
    return res.status(500).json({
      success: false,
      error: "Error actualizando estado de la reserva"
    });
  }
});

export default router;