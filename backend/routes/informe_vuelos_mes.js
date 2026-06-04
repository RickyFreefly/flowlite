// ==========================================
// ✅ routes/informe_vuelos_mes.js
// ==========================================
import express from "express";
import { query } from "../db.js";

const router = express.Router();

/**
 * ==========================================
 * 🪂 INFORME DE PERSONAS QUE VOLARON POR MES
 * ==========================================
 *
 * Filtros disponibles:
 * - ?mes=2026-05
 * - ?inicio=2026-05-01&fin=2026-05-31
 *
 * Ejemplos:
 * GET /informes/vuelos-mes
 * GET /informes/vuelos-mes?mes=2026-05
 * GET /informes/vuelos-mes?inicio=2026-05-01&fin=2026-05-31
 */
router.get("/", async (req, res) => {
  try {
    const { mes, inicio, fin } = req.query;

    const params = [];
    let filtroFecha = "";

    /**
     * Filtro seguro de fechas.
     * No se concatena directamente el valor recibido del frontend.
     */
    if (inicio && fin) {
      params.push(inicio, fin);
      filtroFecha = `
        AND f.createdat::date BETWEEN $${params.length - 1}::date AND $${params.length}::date
      `;
    } else if (mes) {
      params.push(`${mes}-01`);
      filtroFecha = `
        AND f.createdat >= DATE_TRUNC('month', $${params.length}::date)
        AND f.createdat <  DATE_TRUNC('month', $${params.length}::date) + INTERVAL '1 month'
      `;
    } else {
      filtroFecha = "";
    }

    /**
     * Si quieres excluir facturas anuladas o borradores, ajusta aquí los estados reales.
     * Recomendado validar primero:
     *
     * SELECT estado, COUNT(*)
     * FROM public.facturas
     * GROUP BY estado;
     */
    const filtroEstados = `
      AND COALESCE(UPPER(f.estado), '') NOT IN ('ANULADA', 'CANCELADA', 'BORRADOR')
    `;

    // ================================
    // 📘 DETALLE POR MES Y PAQUETE
    // ================================
    const detalleQuery = `
      SELECT
          TO_CHAR(DATE_TRUNC('month', f.createdat), 'YYYY-MM') AS mes,
          DATE_TRUNC('month', f.createdat)::date AS fecha_mes,

          p.idproducto,
          p.codigo,
          p.nombre AS paquete,
          p.tipo,
          p.unidad,

          e.personas_min,
          e.personas_max,
          e.personas_promedio,

          SUM(fd.cantidad)::numeric(12,2) AS paquetes_vendidos,

          SUM(fd.cantidad * e.personas_min)::numeric(12,2) AS personas_min_estimadas,
          SUM(fd.cantidad * e.personas_max)::numeric(12,2) AS personas_max_estimadas,
          SUM(fd.cantidad * e.personas_promedio)::numeric(12,2) AS personas_estimadas,

          SUM(fd.subtotal)::numeric(14,2) AS subtotal_vendido,
          SUM(COALESCE(fd.descuento, 0))::numeric(14,2) AS descuento_total,
          SUM(COALESCE(fd.impuesto_valor, 0))::numeric(14,2) AS impuesto_total,

          SUM(
            fd.subtotal 
            - COALESCE(fd.descuento, 0) 
            + COALESCE(fd.impuesto_valor, 0)
          )::numeric(14,2) AS total_vendido

      FROM public.factura_detalles fd
      INNER JOIN public.facturas f
          ON f.idfactura = fd.idfactura
      INNER JOIN public.productos p
          ON p.idproducto = fd.idproducto
      INNER JOIN public.producto_personas_equivalencia e
          ON e.idproducto = p.idproducto

      WHERE e.aplica_informe_vuelos = TRUE
        ${filtroEstados}
        ${filtroFecha}

      GROUP BY
          DATE_TRUNC('month', f.createdat),
          p.idproducto,
          p.codigo,
          p.nombre,
          p.tipo,
          p.unidad,
          e.personas_min,
          e.personas_max,
          e.personas_promedio

      ORDER BY
          fecha_mes DESC,
          personas_estimadas DESC,
          paquete ASC;
    `;

    // ================================
    // 📊 RESUMEN TOTAL POR MES
    // ================================
    const resumenQuery = `
      SELECT
          TO_CHAR(DATE_TRUNC('month', f.createdat), 'YYYY-MM') AS mes,
          DATE_TRUNC('month', f.createdat)::date AS fecha_mes,

          COUNT(DISTINCT f.idfactura) AS total_facturas,
          COUNT(DISTINCT p.idproducto) AS productos_vendidos,

          SUM(fd.cantidad)::numeric(12,2) AS paquetes_vendidos,

          SUM(fd.cantidad * e.personas_min)::numeric(12,2) AS personas_min_estimadas,
          SUM(fd.cantidad * e.personas_max)::numeric(12,2) AS personas_max_estimadas,
          SUM(fd.cantidad * e.personas_promedio)::numeric(12,2) AS personas_estimadas,

          SUM(fd.subtotal)::numeric(14,2) AS subtotal_vendido,
          SUM(COALESCE(fd.descuento, 0))::numeric(14,2) AS descuento_total,
          SUM(COALESCE(fd.impuesto_valor, 0))::numeric(14,2) AS impuesto_total,

          SUM(
            fd.subtotal 
            - COALESCE(fd.descuento, 0) 
            + COALESCE(fd.impuesto_valor, 0)
          )::numeric(14,2) AS total_vendido

      FROM public.factura_detalles fd
      INNER JOIN public.facturas f
          ON f.idfactura = fd.idfactura
      INNER JOIN public.productos p
          ON p.idproducto = fd.idproducto
      INNER JOIN public.producto_personas_equivalencia e
          ON e.idproducto = p.idproducto

      WHERE e.aplica_informe_vuelos = TRUE
        ${filtroEstados}
        ${filtroFecha}

      GROUP BY
          DATE_TRUNC('month', f.createdat)

      ORDER BY
          fecha_mes DESC;
    `;

    // ================================
    // 🏆 TOP PAQUETES MÁS VENDIDOS
    // ================================
    const topPaquetesQuery = `
      SELECT
          p.idproducto,
          p.codigo,
          p.nombre AS paquete,

          SUM(fd.cantidad)::numeric(12,2) AS paquetes_vendidos,
          SUM(fd.cantidad * e.personas_promedio)::numeric(12,2) AS personas_estimadas,

          SUM(
            fd.subtotal 
            - COALESCE(fd.descuento, 0) 
            + COALESCE(fd.impuesto_valor, 0)
          )::numeric(14,2) AS total_vendido

      FROM public.factura_detalles fd
      INNER JOIN public.facturas f
          ON f.idfactura = fd.idfactura
      INNER JOIN public.productos p
          ON p.idproducto = fd.idproducto
      INNER JOIN public.producto_personas_equivalencia e
          ON e.idproducto = p.idproducto

      WHERE e.aplica_informe_vuelos = TRUE
        ${filtroEstados}
        ${filtroFecha}

      GROUP BY
          p.idproducto,
          p.codigo,
          p.nombre

      ORDER BY
          personas_estimadas DESC,
          total_vendido DESC

      LIMIT 10;
    `;

    const [detalle, resumen, topPaquetes] = await Promise.all([
      query(detalleQuery, params),
      query(resumenQuery, params),
      query(topPaquetesQuery, params),
    ]);

    res.json({
      filtro: {
        mes: mes || null,
        inicio: inicio || null,
        fin: fin || null,
      },
      resumen: resumen.rows,
      detalle: detalle.rows,
      top_paquetes: topPaquetes.rows,
    });

  } catch (error) {
    console.error("❌ Error generando informe de vuelos por mes:", error);
    res.status(500).json({
      error: "Error generando informe de vuelos por mes",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;