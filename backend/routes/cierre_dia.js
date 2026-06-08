// ==========================================
// ✅ routes/cierre_dia.js
// ==========================================
import express from "express";
import { query } from "../db.js";

const router = express.Router();

/**
 * ================================
 * 🧾 INFORME DE CIERRE (por fecha o rango)
 * ================================
 */
router.get("/", async (req, res) => {
  try {
    const { fecha, inicio, fin } = req.query;
    const idempresa = req.headers["x-empresa-id"];

    // ================================
    // 🔐 Validar empresa
    // ================================
    if (!idempresa) {
      return res.status(400).json({
        error: "No se recibió el idempresa en el header x-empresa-id",
      });
    }

    // ================================
    // 🔎 Filtro flexible de fechas seguro
    // ================================
    let filtroFecha = "";
    let params = [];

    if (inicio && fin) {
      filtroFecha = "BETWEEN $1::date AND $2::date";
      params = [inicio, fin, idempresa];
    } else if (fecha) {
      filtroFecha = "= $1::date";
      params = [fecha, idempresa];
    } else {
      filtroFecha = "= CURRENT_DATE";
      params = [idempresa];
    }

    const idEmpresaParam = params.length;

    // ================================
    // 📘 DETALLE DE MOVIMIENTOS
    // ================================
    const detalleQuery = `
      WITH movimientos AS (
          -- 🟦 RESERVAS
          SELECT 
              'RESERVA' AS tipo,
              TRIM(CONCAT_WS(' ', c.nombres, c.apellidos)) AS cliente,
              p.nombre AS producto,
              COALESCE(mp.nombre, 'N/A') AS medio_pago,
              r.estado,
              r.createdat::timestamp AS fecha,
              COALESCE(r.valorreserva, 0) AS valor
          FROM reservas r
          LEFT JOIN clientes c 
              ON r.idcliente = c.idcliente
             AND c.idempresa = r.idempresa
          LEFT JOIN productos p 
              ON r.idproducto = p.idproducto
             AND p.idempresa = r.idempresa
          LEFT JOIN medios_pago mp 
              ON r.idmedio::text = mp.idmedio::text
             AND mp.idempresa = r.idempresa
          WHERE r.createdat::date ${filtroFecha}
            AND r.idempresa = $${idEmpresaParam}

          UNION ALL

          -- 🟩 FACTURAS
          SELECT 
              'FACTURA' AS tipo,
              COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', c.nombres, c.apellidos)), ''),
                c.razonsocial,
                'Cliente sin nombre'
              ) AS cliente,
              NULL AS producto,
              COALESCE(mp_list.medios, 'N/A') AS medio_pago,
              f.estado,
              f.createdat::timestamp AS fecha,
              (
                COALESCE(f.total, 0) - COALESCE((
                    SELECT SUM(COALESCE(r2.valorreserva, 0))
                    FROM reservas r2
                    WHERE r2.idcliente = f.idcliente
                      AND r2.idempresa = f.idempresa
                      AND r2.createdat::date < f.createdat::date
                ), 0)
              ) AS valor
          FROM facturas f
          LEFT JOIN clientes c 
              ON f.idcliente = c.idcliente
             AND c.idempresa = f.idempresa
          LEFT JOIN LATERAL (
              SELECT STRING_AGG(DISTINCT mp.nombre, ' + ') AS medios
              FROM factura_pagos fp
              LEFT JOIN medios_pago mp 
                  ON fp.idmedio::text = mp.idmedio::text
                 AND mp.idempresa = f.idempresa
              WHERE fp.idfactura = f.idfactura
                AND fp.idempresa = f.idempresa
          ) mp_list ON TRUE
          WHERE f.createdat::date ${filtroFecha}
            AND f.idempresa = $${idEmpresaParam}

          UNION ALL

          -- 🟥 EGRESOS
          SELECT 
              'EGRESO' AS tipo,
              COALESCE(e.proveedor, 'Proveedor no registrado') AS cliente,
              e.concepto AS producto,
              COALESCE(e.metodopago, 'N/A') AS medio_pago,
              'Registrado' AS estado,
              e.createdat::timestamp AS fecha,
              COALESCE(e.valor, 0) AS valor
          FROM egresos e
          WHERE e.createdat::date ${filtroFecha}
            AND e.idempresa = $${idEmpresaParam}
      )
      SELECT 
          tipo,
          cliente,
          producto,
          medio_pago,
          estado,
          TO_CHAR(fecha, 'YYYY-MM-DD HH24:MI') AS fecha,
          valor
      FROM movimientos
      WHERE valor > 0
      ORDER BY fecha;
    `;

    // ================================
    // 📊 TOTALES
    // ================================
    const totalesQuery = `
      WITH reservas_total AS (
          SELECT COALESCE(SUM(valorreserva), 0) AS total
          FROM reservas
          WHERE createdat::date ${filtroFecha}
            AND idempresa = $${idEmpresaParam}

      ),
      facturas_total AS (
          SELECT COALESCE(SUM(
            COALESCE(f.total, 0) - COALESCE((
                SELECT SUM(COALESCE(r2.valorreserva, 0))
                FROM reservas r2
                WHERE r2.idcliente = f.idcliente
                  AND r2.idempresa = f.idempresa
                  AND r2.createdat::date < f.createdat::date
            ), 0)
          ), 0) AS total
          FROM facturas f
          WHERE f.createdat::date ${filtroFecha}
            AND f.idempresa = $${idEmpresaParam}
      ),
      egresos_total AS (
          SELECT COALESCE(SUM(valor), 0) AS total
          FROM egresos
          WHERE createdat::date ${filtroFecha}
            AND idempresa = $${idEmpresaParam}
      )
      SELECT 
          'Ingresos' AS tipo,
          COALESCE(r.total, 0) + COALESCE(f.total, 0) AS total,
          '+' AS signo
      FROM reservas_total r, facturas_total f

      UNION ALL

      SELECT 
          'Egresos' AS tipo,
          COALESCE(e.total, 0) AS total,
          '-' AS signo
      FROM egresos_total e

      UNION ALL

      SELECT 
          'Saldo Neto' AS tipo,
          (COALESCE(r.total, 0) + COALESCE(f.total, 0)) - COALESCE(e.total, 0) AS total,
          '' AS signo
      FROM reservas_total r, facturas_total f, egresos_total e;
    `;

    // ================================
    // ▶️ Ejecutar consultas
    // ================================
    const [detalle, totales] = await Promise.all([
      query(detalleQuery, params),
      query(totalesQuery, params),
    ]);

    // ================================
    // ✅ Respuesta final
    // ================================
    res.json({
      idempresa,
      fecha_cierre:
        fecha ||
        (inicio && fin
          ? `${inicio} a ${fin}`
          : new Date().toISOString().split("T")[0]),
      detalle: detalle.rows,
      totales: totales.rows,
    });

  } catch (error) {
    console.error("❌ Error generando informe de cierre:", error);
    res.status(500).json({
      error: "Error generando informe de cierre",
      detalle: error.message,
    });
  }
});

export default router;