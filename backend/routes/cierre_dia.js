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

    // —— Filtro flexible de fechas
    let filtroFecha = "";
    if (inicio && fin) {
      filtroFecha = `BETWEEN '${inicio}' AND '${fin}'`;
    } else if (fecha) {
      filtroFecha = `= '${fecha}'`;
    } else {
      filtroFecha = "= CURRENT_DATE";
    }

    // ================================
    // 📘 DETALLE DE MOVIMIENTOS (con medios de pago)
    // ================================
    const detalleQuery = `
      WITH movimientos AS (
          -- 🟦 RESERVAS
          SELECT 
              'RESERVA' AS tipo,
              TRIM(CONCAT_WS(' ', c.nombres, c.apellidos)) AS cliente,
              p.nombre AS producto,
              mp.nombre AS medio_pago,
              r.estado,
              r.createdat::timestamp AS fecha,
              r.valorreserva AS valor
          FROM reservas r
          LEFT JOIN clientes c ON r.idcliente = c.idcliente
          LEFT JOIN productos p ON r.idproducto = p.idproducto
          LEFT JOIN medios_pago mp ON r.idmedio = mp.idmedio
          WHERE r.createdat::date ${filtroFecha}
            AND r.estado <> 'FACTURADO'  -- 🚫 excluir reservas facturadas

          UNION ALL

          -- 🟩 FACTURAS
          SELECT 
              'FACTURA' AS tipo,
              COALESCE(TRIM(CONCAT_WS(' ', c.nombres, c.apellidos)), c.razonsocial) AS cliente,
              NULL AS producto,
              COALESCE(mp_list.medios, 'N/A') AS medio_pago,
              f.estado,
              f.createdat::timestamp AS fecha,
              (
                f.total - COALESCE((
                    SELECT SUM(r2.valorreserva)
                    FROM reservas r2
                    WHERE r2.idcliente = f.idcliente
                    AND r2.createdat::date < f.createdat::date
                ), 0)
              ) AS valor
          FROM facturas f
          LEFT JOIN clientes c ON f.idcliente = c.idcliente
          LEFT JOIN LATERAL (
              SELECT STRING_AGG(DISTINCT mp.nombre, ' + ') AS medios
              FROM factura_pagos fp
              LEFT JOIN medios_pago mp ON fp.idmedio = mp.idmedio
              WHERE fp.idfactura = f.idfactura
          ) mp_list ON TRUE
          WHERE f.createdat::date ${filtroFecha}

          UNION ALL

          -- 🟥 EGRESOS
          SELECT 
              'EGRESO' AS tipo,
              e.proveedor AS cliente,
              e.concepto AS producto,
              COALESCE(e.metodopago, 'N/A') AS medio_pago,
              'Registrado' AS estado,
              e.createdat::timestamp AS fecha,
              e.valor AS valor
          FROM egresos e
          WHERE e.createdat::date ${filtroFecha}
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
    // 📊 TOTALES (ajustado también para excluir reservas facturadas)
    // ================================
    const totalesQuery = `
      WITH reservas_total AS (
          SELECT SUM(valorreserva) AS total
          FROM reservas
          WHERE createdat::date ${filtroFecha}
            AND estado <> 'FACTURADO'  -- 🚫 excluir reservas facturadas
      ),
      facturas_total AS (
          SELECT SUM(
            f.total - COALESCE((
                SELECT SUM(r2.valorreserva)
                FROM reservas r2
                WHERE r2.idcliente = f.idcliente
                AND r2.createdat::date < f.createdat::date
            ), 0)
          ) AS total
          FROM facturas f
          WHERE f.createdat::date ${filtroFecha}
      ),
      egresos_total AS (
          SELECT SUM(valor) AS total
          FROM egresos
          WHERE createdat::date ${filtroFecha}
      )
      SELECT 'Ingresos' AS tipo,
             COALESCE(r.total,0) + COALESCE(f.total,0) AS total,
             '+' AS signo
      FROM reservas_total r, facturas_total f
      UNION ALL
      SELECT 'Egresos' AS tipo,
             COALESCE(e.total,0) AS total,
             '-' AS signo
      FROM egresos_total e
      UNION ALL
      SELECT 'Saldo Neto' AS tipo,
             (COALESCE(r.total,0) + COALESCE(f.total,0)) - COALESCE(e.total,0) AS total,
             '' AS signo
      FROM reservas_total r, facturas_total f, egresos_total e;
    `;

    // —— Ejecuta ambas consultas en paralelo
    const [detalle, totales] = await Promise.all([
      query(detalleQuery),
      query(totalesQuery),
    ]);

    // —— Respuesta final
    res.json({
      fecha_cierre:
        fecha || (inicio && fin ? `${inicio} a ${fin}` : new Date().toISOString().split("T")[0]),
      detalle: detalle.rows,
      totales: totales.rows,
    });

  } catch (error) {
    console.error("❌ Error generando informe de cierre:", error);
    res.status(500).json({ error: "Error generando informe de cierre" });
  }
});

export default router;
