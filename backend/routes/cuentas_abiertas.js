// routes/cuentas_abiertas.js
import express from "express";
import { query } from "../db.js";
import { authJwt } from "./authJwt.js";
import { companyAccess } from "./companyAccess.js";

const router = express.Router();

/**
 * Multitenant:
 * - authJwt identifica al usuario.
 * - companyAccess valida x-empresa-id y asigna req.idempresa.
 */
router.use(authJwt, companyAccess);

// ================== HELPERS ==================

function limpiarTexto(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizarValor(value) {
  const numero = Number(value);
  if (!Number.isFinite(numero)) return 0;
  return Math.round(numero * 100) / 100;
}

function normalizarIdEntero(value) {
  const numero = Number(value);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  return numero;
}

function normalizarIdEmpresa(req) {
  const idempresa = req.idempresa ?? req.headers["x-empresa-id"];

  if (idempresa === null || idempresa === undefined) {
    return "";
  }

  return String(idempresa).trim();
}

function obtenerIdUsuario(req) {
  return req.user?.idusuario || req.user?.id || null;
}

function validarEstadoCuenta(estado) {
  const estadoLimpio = limpiarTexto(estado).toUpperCase();

  if (!estadoLimpio) return "";

  if (!["ABIERTA", "CERRADA"].includes(estadoLimpio)) {
    return "";
  }

  return estadoLimpio;
}

function obtenerPeriodo(fecha = null) {
  const base = fecha ? new Date(fecha) : new Date();

  if (Number.isNaN(base.getTime())) {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  }

  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function obtenerFechaConsumo(fecha = null) {
  if (!fecha) {
    return new Date().toISOString().slice(0, 10);
  }

  const parsed = new Date(fecha);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizarDetalleConsumo(detalle) {
  const idproducto = normalizarIdEntero(detalle?.idproducto);
  const cantidad = normalizarValor(detalle?.cantidad || 1);
  const valorunitario = normalizarValor(detalle?.valorunitario || detalle?.precio || 0);
  const subtotalCalculado = normalizarValor(cantidad * valorunitario);
  const subtotal = normalizarValor(detalle?.subtotal || subtotalCalculado);

  return {
    idproducto,
    descripcion: limpiarTexto(detalle?.descripcion),
    cantidad,
    valorunitario,
    subtotal,
  };
}

function normalizarPagoCuenta(pago) {
  const valor = normalizarValor(pago?.valor);
  const idmedio_pago = limpiarTexto(pago?.idmedio_pago || pago?.idmedio || pago?.medio);

  return {
    idmedio_pago: idmedio_pago || null,
    valor,
    observacion: limpiarTexto(pago?.observacion),
  };
}

// ================== HELPERS DB ==================

async function obtenerClienteEmpresa(idcliente, idempresa) {
  const result = await query(
    `
    SELECT *
    FROM public.clientes
    WHERE idcliente = $1
      AND idempresa = $2
    LIMIT 1
    `,
    [idcliente, idempresa]
  );

  return result.rows[0] || null;
}

async function obtenerProductoEmpresa(idproducto, idempresa) {
  const result = await query(
    `
    SELECT *
    FROM public.productos
    WHERE idproducto = $1
      AND idempresa = $2
    LIMIT 1
    `,
    [idproducto, idempresa]
  );

  return result.rows[0] || null;
}

async function obtenerCuentaAbiertaPorCliente(idcliente, idempresa) {
  const result = await query(
    `
    SELECT *
    FROM public.cuentas_abiertas
    WHERE idcliente = $1
      AND idempresa = $2
      AND estado = 'ABIERTA'
    ORDER BY idcuenta DESC
    LIMIT 1
    `,
    [idcliente, idempresa]
  );

  return result.rows[0] || null;
}

async function obtenerCuentaPorId(idcuenta, idempresa) {
  const result = await query(
    `
    SELECT *
    FROM public.cuentas_abiertas
    WHERE idcuenta = $1
      AND idempresa = $2
    LIMIT 1
    `,
    [idcuenta, idempresa]
  );

  return result.rows[0] || null;
}

async function crearCuentaAbierta({ idempresa, idcliente }) {
  const result = await query(
    `
    INSERT INTO public.cuentas_abiertas (
      idempresa,
      idcliente,
      saldo_actual,
      estado,
      fecha_apertura,
      createdat,
      updatedat
    )
    VALUES ($1, $2, 0, 'ABIERTA', NOW(), NOW(), NOW())
    RETURNING *
    `,
    [idempresa, idcliente]
  );

  return result.rows[0];
}

async function reabrirCuentaCerradaSiAplica({ idempresa, idcliente }) {
  const result = await query(
    `
    SELECT *
    FROM public.cuentas_abiertas
    WHERE idcliente = $1
      AND idempresa = $2
      AND estado = 'CERRADA'
    ORDER BY idcuenta DESC
    LIMIT 1
    `,
    [idcliente, idempresa]
  );

  const cuentaCerrada = result.rows[0];

  if (!cuentaCerrada) return null;

  const update = await query(
    `
    UPDATE public.cuentas_abiertas
    SET estado = 'ABIERTA',
        fecha_cierre = NULL,
        updatedat = NOW()
    WHERE idcuenta = $1
      AND idempresa = $2
    RETURNING *
    `,
    [cuentaCerrada.idcuenta, idempresa]
  );

  return update.rows[0];
}

async function obtenerOCrearCuentaAbierta({ idempresa, idcliente }) {
  let cuenta = await obtenerCuentaAbiertaPorCliente(idcliente, idempresa);

  if (!cuenta) {
    cuenta = await crearCuentaAbierta({
      idempresa,
      idcliente,
    });
  }

  return cuenta;
}

async function registrarMovimientoCuenta({
  idempresa,
  idcliente,
  idcuenta,
  tipo_movimiento,
  valor,
  idfactura = null,
  idventa = null,
  idmedio_pago = null,
  observacion = "",
  creado_por = null,
  saldo_nuevo_forzado = null,
}) {
  const cuenta = await obtenerCuentaPorId(idcuenta, idempresa);

  if (!cuenta) {
    throw new Error("Cuenta abierta no encontrada");
  }

  if (cuenta.estado !== "ABIERTA") {
    throw new Error("La cuenta no está abierta");
  }

  const saldoAnterior = normalizarValor(cuenta.saldo_actual);
  const valorMovimiento = normalizarValor(valor);

  let saldoNuevo = saldoAnterior;

  if (tipo_movimiento === "CARGO") {
    saldoNuevo = saldoAnterior + valorMovimiento;
  } else if (tipo_movimiento === "ABONO") {
    saldoNuevo = saldoAnterior - valorMovimiento;
  } else if (tipo_movimiento === "AJUSTE") {
    if (saldo_nuevo_forzado === null || saldo_nuevo_forzado === undefined) {
      throw new Error("El ajuste requiere saldo_nuevo_forzado");
    }

    saldoNuevo = normalizarValor(saldo_nuevo_forzado);
  } else {
    throw new Error("Tipo de movimiento no válido");
  }

  saldoNuevo = normalizarValor(saldoNuevo);

  if (saldoNuevo < 0) {
    throw new Error("El movimiento no puede dejar saldo negativo");
  }

  const nuevoEstado = saldoNuevo === 0 ? "CERRADA" : "ABIERTA";
  const fechaCierreSQL = saldoNuevo === 0 ? "NOW()" : "NULL";

  const movimientoResult = await query(
    `
    INSERT INTO public.cuenta_abierta_movimientos (
      idempresa,
      idcuenta,
      idcliente,
      tipo_movimiento,
      valor,
      saldo_anterior,
      saldo_nuevo,
      idfactura,
      idventa,
      idmedio_pago,
      observacion,
      creado_por,
      createdat
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, NOW()
    )
    RETURNING *
    `,
    [
      idempresa,
      idcuenta,
      idcliente,
      tipo_movimiento,
      valorMovimiento,
      saldoAnterior,
      saldoNuevo,
      idfactura || null,
      idventa || null,
      idmedio_pago || null,
      limpiarTexto(observacion) || null,
      creado_por || null,
    ]
  );

  const cuentaResult = await query(
    `
    UPDATE public.cuentas_abiertas
    SET saldo_actual = $1,
        estado = $2,
        fecha_cierre = ${fechaCierreSQL},
        updatedat = NOW()
    WHERE idcuenta = $3
      AND idempresa = $4
    RETURNING *
    `,
    [saldoNuevo, nuevoEstado, idcuenta, idempresa]
  );

  return {
    cuenta: cuentaResult.rows[0],
    movimiento: movimientoResult.rows[0],
  };
}

async function registrarDetalleConsumo({
  idempresa,
  idcuenta,
  idcliente,
  detalle,
  fecha_consumo,
  periodo,
}) {
  const result = await query(
    `
    INSERT INTO public.cuenta_abierta_detalles (
      idempresa,
      idcuenta,
      idcliente,
      idproducto,
      descripcion,
      cantidad,
      valorunitario,
      subtotal,
      fecha_consumo,
      periodo,
      facturado,
      createdat
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      false,
      NOW()
    )
    RETURNING *
    `,
    [
      idempresa,
      idcuenta,
      idcliente,
      detalle.idproducto,
      detalle.descripcion || null,
      detalle.cantidad,
      detalle.valorunitario,
      detalle.subtotal,
      fecha_consumo,
      periodo,
    ]
  );

  return result.rows[0];
}

// ================== GET: Listar cuentas abiertas ==================

router.get("/", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    const {
      cliente,
      estado = "",
      page = 1,
      per_page = 10,
    } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const currentPerPage = Math.max(Number(per_page) || 10, 1);
    const offset = (currentPage - 1) * currentPerPage;

    const estadoLimpio = validarEstadoCuenta(estado);

    const whereClauses = ["ca.idempresa = $1"];
    const params = [idempresa];
    let idx = 2;

    if (cliente) {
      whereClauses.push(`
        (
          c.razonsocial ILIKE $${idx}
          OR c.nombres ILIKE $${idx}
          OR c.apellidos ILIKE $${idx}
          OR c.identificacion ILIKE $${idx}
        )
      `);
      params.push(`%${limpiarTexto(cliente)}%`);
      idx++;
    }

    if (estadoLimpio) {
      whereClauses.push(`ca.estado = $${idx}`);
      params.push(estadoLimpio);
      idx++;
    }

    const whereSQL = `WHERE ${whereClauses.join(" AND ")}`;

    const cuentasSQL = `
      SELECT
        ca.idcuenta,
        ca.idempresa,
        ca.idcliente,
        ca.saldo_actual,
        ca.estado,
        ca.fecha_apertura,
        ca.fecha_cierre,
        ca.createdat,
        ca.updatedat,
        c.identificacion,
        COALESCE(
          NULLIF(c.razonsocial, ''),
          TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        ) AS nombre_cliente,
        (
          SELECT COALESCE(SUM(d.subtotal), 0)
          FROM public.cuenta_abierta_detalles d
          WHERE d.idcuenta = ca.idcuenta
            AND d.idempresa = ca.idempresa
            AND d.facturado = false
        ) AS total_consumido_no_facturado,
        (
          SELECT COUNT(*)
          FROM public.cuenta_abierta_detalles d
          WHERE d.idcuenta = ca.idcuenta
            AND d.idempresa = ca.idempresa
            AND d.facturado = false
        ) AS total_items_no_facturados,
        (
          SELECT MAX(m.createdat)
          FROM public.cuenta_abierta_movimientos m
          WHERE m.idcuenta = ca.idcuenta
            AND m.idempresa = ca.idempresa
        ) AS ultimo_movimiento
      FROM public.cuentas_abiertas ca
      JOIN public.clientes c
        ON c.idcliente = ca.idcliente
       AND c.idempresa = ca.idempresa
      ${whereSQL}
      ORDER BY ca.updatedat DESC, ca.idcuenta DESC
      LIMIT $${idx}
      OFFSET $${idx + 1}
    `;

    const cuentas = await query(cuentasSQL, [
      ...params,
      currentPerPage,
      offset,
    ]);

    const countSQL = `
      SELECT COUNT(*) AS total
      FROM public.cuentas_abiertas ca
      JOIN public.clientes c
        ON c.idcliente = ca.idcliente
       AND c.idempresa = ca.idempresa
      ${whereSQL}
    `;

    const count = await query(countSQL, params);
    const total = Number(count.rows[0]?.total || 0);

    const resumenSQL = `
      SELECT
        COALESCE(SUM(CASE WHEN estado = 'ABIERTA' THEN saldo_actual ELSE 0 END), 0) AS total_cartera,
        COUNT(*) FILTER (WHERE estado = 'ABIERTA') AS cuentas_abiertas,
        COUNT(*) FILTER (WHERE estado = 'CERRADA') AS cuentas_cerradas
      FROM public.cuentas_abiertas
      WHERE idempresa = $1
    `;

    const resumen = await query(resumenSQL, [idempresa]);

    const consumoMesSQL = `
      SELECT COALESCE(SUM(subtotal), 0) AS total_consumido_mes
      FROM public.cuenta_abierta_detalles
      WHERE idempresa = $1
        AND periodo = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
    `;

    const consumoMes = await query(consumoMesSQL, [idempresa]);

    return res.json({
      success: true,
      cuentas: cuentas.rows,
      resumen: {
        total_cartera: Number(resumen.rows[0]?.total_cartera || 0),
        cuentas_abiertas: Number(resumen.rows[0]?.cuentas_abiertas || 0),
        cuentas_cerradas: Number(resumen.rows[0]?.cuentas_cerradas || 0),
        total_consumido_mes: Number(consumoMes.rows[0]?.total_consumido_mes || 0),
      },
      page: currentPage,
      per_page: currentPerPage,
      total,
      total_pages: Math.ceil(total / currentPerPage),
    });
  } catch (error) {
    console.error("❌ Error listando cuentas abiertas:", error);

    return res.status(500).json({
      success: false,
      error: "Error al obtener cuentas abiertas",
      detail: error.message,
    });
  }
});

// ================== GET: Cuenta abierta por cliente ==================

router.get("/cliente/:idcliente", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);
    const idcliente = normalizarIdEntero(req.params.idcliente);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idcliente) {
      return res.status(400).json({
        success: false,
        error: "Cliente inválido",
      });
    }

    const cliente = await obtenerClienteEmpresa(idcliente, idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const cuentaResult = await query(
      `
      SELECT
        ca.*,
        c.identificacion,
        COALESCE(
          NULLIF(c.razonsocial, ''),
          TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        ) AS nombre_cliente
      FROM public.cuentas_abiertas ca
      JOIN public.clientes c
        ON c.idcliente = ca.idcliente
       AND c.idempresa = ca.idempresa
      WHERE ca.idcliente = $1
        AND ca.idempresa = $2
      ORDER BY 
        CASE WHEN ca.estado = 'ABIERTA' THEN 0 ELSE 1 END,
        ca.idcuenta DESC
      LIMIT 1
      `,
      [idcliente, idempresa]
    );

    if (cuentaResult.rows.length === 0) {
      return res.json({
        success: true,
        cliente: {
          idcliente: cliente.idcliente,
          identificacion: cliente.identificacion,
          nombre_cliente:
            cliente.razonsocial ||
            `${cliente.nombres || ""} ${cliente.apellidos || ""}`.trim(),
        },
        cuenta: null,
        movimientos: [],
        detalles: [],
        resumen_mensual: [],
      });
    }

    const cuenta = cuentaResult.rows[0];

    const movimientos = await query(
      `
      SELECT
        m.*,
        mp.nombre AS medio_pago,
        f.siigo_number,
        f.public_url
      FROM public.cuenta_abierta_movimientos m
      LEFT JOIN public.medios_pago mp
        ON mp.idmedio::text = m.idmedio_pago::text
       AND mp.idempresa = m.idempresa
      LEFT JOIN public.facturas f
        ON f.idfactura = m.idfactura
       AND f.idempresa = m.idempresa
      WHERE m.idcuenta = $1
        AND m.idempresa = $2
      ORDER BY m.createdat DESC, m.idmovimiento DESC
      `,
      [cuenta.idcuenta, idempresa]
    );

    const detalles = await query(
      `
      SELECT
        d.*,
        p.codigo AS producto_codigo,
        p.nombre AS producto_nombre
      FROM public.cuenta_abierta_detalles d
      LEFT JOIN public.productos p
        ON p.idproducto = d.idproducto
       AND p.idempresa = d.idempresa
      WHERE d.idcuenta = $1
        AND d.idempresa = $2
      ORDER BY d.fecha_consumo DESC, d.createdat DESC, d.iddetalle DESC
      `,
      [cuenta.idcuenta, idempresa]
    );

    const resumenMensual = await query(
      `
      SELECT
        periodo,
        COALESCE(SUM(subtotal), 0) AS total_consumido,
        COUNT(*) AS total_items
      FROM public.cuenta_abierta_detalles
      WHERE idcuenta = $1
        AND idempresa = $2
      GROUP BY periodo
      ORDER BY periodo DESC
      `,
      [cuenta.idcuenta, idempresa]
    );

    return res.json({
      success: true,
      cuenta,
      movimientos: movimientos.rows,
      detalles: detalles.rows,
      resumen_mensual: resumenMensual.rows,
    });
  } catch (error) {
    console.error("❌ Error consultando cuenta por cliente:", error);

    return res.status(500).json({
      success: false,
      error: "Error consultando cuenta del cliente",
      detail: error.message,
    });
  }
});

// ================== GET: Detalle de cuenta por ID ==================

router.get("/:idcuenta", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);
    const idcuenta = normalizarIdEntero(req.params.idcuenta);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idcuenta) {
      return res.status(400).json({
        success: false,
        error: "Cuenta inválida",
      });
    }

    const cuentaResult = await query(
      `
      SELECT
        ca.*,
        c.identificacion,
        COALESCE(
          NULLIF(c.razonsocial, ''),
          TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        ) AS nombre_cliente
      FROM public.cuentas_abiertas ca
      JOIN public.clientes c
        ON c.idcliente = ca.idcliente
       AND c.idempresa = ca.idempresa
      WHERE ca.idcuenta = $1
        AND ca.idempresa = $2
      LIMIT 1
      `,
      [idcuenta, idempresa]
    );

    if (cuentaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cuenta abierta no encontrada",
      });
    }

    const cuenta = cuentaResult.rows[0];

    const movimientos = await query(
      `
      SELECT
        m.*,
        mp.nombre AS medio_pago,
        f.siigo_number,
        f.public_url
      FROM public.cuenta_abierta_movimientos m
      LEFT JOIN public.medios_pago mp
        ON mp.idmedio::text = m.idmedio_pago::text
       AND mp.idempresa = m.idempresa
      LEFT JOIN public.facturas f
        ON f.idfactura = m.idfactura
       AND f.idempresa = m.idempresa
      WHERE m.idcuenta = $1
        AND m.idempresa = $2
      ORDER BY m.createdat DESC, m.idmovimiento DESC
      `,
      [idcuenta, idempresa]
    );

    const detalles = await query(
      `
      SELECT
        d.*,
        p.codigo AS producto_codigo,
        p.nombre AS producto_nombre
      FROM public.cuenta_abierta_detalles d
      LEFT JOIN public.productos p
        ON p.idproducto = d.idproducto
       AND p.idempresa = d.idempresa
      WHERE d.idcuenta = $1
        AND d.idempresa = $2
      ORDER BY d.fecha_consumo DESC, d.createdat DESC, d.iddetalle DESC
      `,
      [idcuenta, idempresa]
    );

    const resumenMensual = await query(
      `
      SELECT
        periodo,
        COALESCE(SUM(subtotal), 0) AS total_consumido,
        COUNT(*) AS total_items
      FROM public.cuenta_abierta_detalles
      WHERE idcuenta = $1
        AND idempresa = $2
      GROUP BY periodo
      ORDER BY periodo DESC
      `,
      [idcuenta, idempresa]
    );

    return res.json({
      success: true,
      cuenta,
      movimientos: movimientos.rows,
      detalles: detalles.rows,
      resumen_mensual: resumenMensual.rows,
    });
  } catch (error) {
    console.error("❌ Error consultando cuenta abierta:", error);

    return res.status(500).json({
      success: false,
      error: "Error consultando cuenta abierta",
      detail: error.message,
    });
  }
});

// ================== GET: Detalles de productos consumidos ==================

router.get("/:idcuenta/detalles", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);
    const idcuenta = normalizarIdEntero(req.params.idcuenta);
    const periodo = limpiarTexto(req.query.periodo);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idcuenta) {
      return res.status(400).json({
        success: false,
        error: "Cuenta inválida",
      });
    }

    const where = ["d.idcuenta = $1", "d.idempresa = $2"];
    const params = [idcuenta, idempresa];
    let idx = 3;

    if (periodo) {
      where.push(`d.periodo = $${idx}`);
      params.push(periodo);
      idx++;
    }

    const result = await query(
      `
      SELECT
        d.*,
        p.codigo AS producto_codigo,
        p.nombre AS producto_nombre
      FROM public.cuenta_abierta_detalles d
      LEFT JOIN public.productos p
        ON p.idproducto = d.idproducto
       AND p.idempresa = d.idempresa
      WHERE ${where.join(" AND ")}
      ORDER BY d.fecha_consumo DESC, d.createdat DESC, d.iddetalle DESC
      `,
      params
    );

    return res.json({
      success: true,
      detalles: result.rows,
    });
  } catch (error) {
    console.error("❌ Error consultando detalles de cuenta:", error);

    return res.status(500).json({
      success: false,
      error: "Error consultando detalles de cuenta",
      detail: error.message,
    });
  }
});

// ================== GET: Resumen mensual ==================

router.get("/:idcuenta/resumen-mensual", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);
    const idcuenta = normalizarIdEntero(req.params.idcuenta);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idcuenta) {
      return res.status(400).json({
        success: false,
        error: "Cuenta inválida",
      });
    }

    const result = await query(
      `
      SELECT
        periodo,
        COALESCE(SUM(subtotal), 0) AS total_consumido,
        COUNT(*) AS total_items
      FROM public.cuenta_abierta_detalles
      WHERE idcuenta = $1
        AND idempresa = $2
      GROUP BY periodo
      ORDER BY periodo DESC
      `,
      [idcuenta, idempresa]
    );

    return res.json({
      success: true,
      resumen_mensual: result.rows,
    });
  } catch (error) {
    console.error("❌ Error consultando resumen mensual:", error);

    return res.status(500).json({
      success: false,
      error: "Error consultando resumen mensual",
      detail: error.message,
    });
  }
});

// ================== POST: Registrar consumo con productos ==================

router.post("/consumo", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);

    const {
      idcliente,
      detalles = [],
      pagos = [],
      fecha_consumo = null,
      observacion = "",
    } = req.body;

    const idclienteLimpio = normalizarIdEntero(idcliente);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idclienteLimpio) {
      return res.status(400).json({
        success: false,
        error: "Cliente obligatorio o inválido",
      });
    }

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Debes agregar al menos un producto o servicio",
      });
    }

    const cliente = await obtenerClienteEmpresa(idclienteLimpio, idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const detallesNormalizados = [];

    for (const detalle of detalles) {
      const d = normalizarDetalleConsumo(detalle);

      if (!d.idproducto || d.cantidad <= 0 || d.valorunitario < 0 || d.subtotal <= 0) {
        return res.status(400).json({
          success: false,
          error: "Todos los productos deben tener producto, cantidad y valor válido",
        });
      }

      const producto = await obtenerProductoEmpresa(d.idproducto, idempresa);

      if (!producto) {
        return res.status(404).json({
          success: false,
          error: `Producto no encontrado para la empresa activa: ${d.idproducto}`,
        });
      }

      if (!d.descripcion) {
        d.descripcion = producto.nombre || producto.descripcion || `Producto ${d.idproducto}`;
      }

      detallesNormalizados.push(d);
    }

    const fechaConsumo = obtenerFechaConsumo(fecha_consumo);
    const periodo = obtenerPeriodo(fechaConsumo);
    const totalConsumo = normalizarValor(
      detallesNormalizados.reduce((acc, item) => acc + normalizarValor(item.subtotal), 0)
    );

    if (totalConsumo <= 0) {
      return res.status(400).json({
        success: false,
        error: "El total del consumo debe ser mayor a cero",
      });
    }

    const pagosNormalizados = Array.isArray(pagos)
      ? pagos
          .map(normalizarPagoCuenta)
          .filter((p) => p.valor > 0)
      : [];

    const totalPagos = normalizarValor(
      pagosNormalizados.reduce((acc, item) => acc + normalizarValor(item.valor), 0)
    );

    if (totalPagos > totalConsumo) {
      return res.status(400).json({
        success: false,
        error: "Los pagos no pueden ser mayores al total consumido",
      });
    }

    let cuenta = await obtenerCuentaAbiertaPorCliente(idclienteLimpio, idempresa);

    if (!cuenta) {
      cuenta = await crearCuentaAbierta({
        idempresa,
        idcliente: idclienteLimpio,
      });
    }

    const detallesInsertados = [];

    for (const detalle of detallesNormalizados) {
      const insertado = await registrarDetalleConsumo({
        idempresa,
        idcuenta: cuenta.idcuenta,
        idcliente: idclienteLimpio,
        detalle,
        fecha_consumo: fechaConsumo,
        periodo,
      });

      detallesInsertados.push(insertado);
    }

    const obsBase =
      limpiarTexto(observacion) ||
      `Consumo registrado en cuenta abierta periodo ${periodo}`;

    const cargo = await registrarMovimientoCuenta({
      idempresa,
      idcliente: idclienteLimpio,
      idcuenta: cuenta.idcuenta,
      tipo_movimiento: "CARGO",
      valor: totalConsumo,
      observacion: obsBase,
      creado_por: obtenerIdUsuario(req),
    });

    let cuentaActualizada = cargo.cuenta;
    const movimientos = [cargo.movimiento];

    for (const pago of pagosNormalizados) {
      const abono = await registrarMovimientoCuenta({
        idempresa,
        idcliente: idclienteLimpio,
        idcuenta: cuenta.idcuenta,
        tipo_movimiento: "ABONO",
        valor: pago.valor,
        idmedio_pago: pago.idmedio_pago,
        observacion:
          pago.observacion ||
          `Abono aplicado al consumo registrado en periodo ${periodo}`,
        creado_por: obtenerIdUsuario(req),
      });

      cuentaActualizada = abono.cuenta;
      movimientos.push(abono.movimiento);
    }

    return res.status(201).json({
      success: true,
      message:
        cuentaActualizada.estado === "CERRADA"
          ? "Consumo y abono registrados correctamente. La cuenta quedó cerrada porque el saldo llegó a cero."
          : "Consumo registrado correctamente en cuenta abierta",
      cuenta: cuentaActualizada,
      detalles: detallesInsertados,
      movimientos,
      resumen: {
        total_consumo: totalConsumo,
        total_pagos: totalPagos,
        saldo_generado: normalizarValor(totalConsumo - totalPagos),
        periodo,
        fecha_consumo: fechaConsumo,
      },
    });
  } catch (error) {
    console.error("❌ Error registrando consumo en cuenta abierta:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error registrando consumo en cuenta abierta",
    });
  }
});

// ================== POST: Registrar cargo manual ==================

router.post("/cargo", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);

    const {
      idcliente,
      valor,
      idfactura = null,
      idventa = null,
      observacion = "",
    } = req.body;

    const idclienteLimpio = normalizarIdEntero(idcliente);
    const valorCargo = normalizarValor(valor);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idclienteLimpio || valorCargo <= 0) {
      return res.status(400).json({
        success: false,
        error: "Cliente y valor mayor a cero son obligatorios",
      });
    }

    const cliente = await obtenerClienteEmpresa(idclienteLimpio, idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const cuenta = await obtenerOCrearCuentaAbierta({
      idempresa,
      idcliente: idclienteLimpio,
    });

    const resultado = await registrarMovimientoCuenta({
      idempresa,
      idcliente: idclienteLimpio,
      idcuenta: cuenta.idcuenta,
      tipo_movimiento: "CARGO",
      valor: valorCargo,
      idfactura: normalizarIdEntero(idfactura),
      idventa: normalizarIdEntero(idventa),
      observacion:
        limpiarTexto(observacion) ||
        `Cargo manual registrado en cuenta abierta por valor de ${valorCargo}`,
      creado_por: obtenerIdUsuario(req),
    });

    return res.json({
      success: true,
      message: "Cargo registrado correctamente",
      cuenta: resultado.cuenta,
      movimiento: resultado.movimiento,
    });
  } catch (error) {
    console.error("❌ Error registrando cargo:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error registrando cargo en cuenta abierta",
    });
  }
});

// ================== POST: Registrar abono ==================

router.post("/abono", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);

    const {
      idcliente,
      valor,
      idmedio_pago = null,
      observacion = "",
    } = req.body;

    const idclienteLimpio = normalizarIdEntero(idcliente);
    const valorAbono = normalizarValor(valor);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idclienteLimpio || valorAbono <= 0) {
      return res.status(400).json({
        success: false,
        error: "Cliente y valor mayor a cero son obligatorios",
      });
    }

    const cliente = await obtenerClienteEmpresa(idclienteLimpio, idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const cuenta = await obtenerCuentaAbiertaPorCliente(idclienteLimpio, idempresa);

    if (!cuenta) {
      return res.status(404).json({
        success: false,
        error: "El cliente no tiene cuenta abierta activa",
      });
    }

    const saldoActual = normalizarValor(cuenta.saldo_actual);

    if (valorAbono > saldoActual) {
      return res.status(400).json({
        success: false,
        error: `El abono no puede ser mayor al saldo actual. Saldo actual: ${saldoActual}`,
      });
    }

    const resultado = await registrarMovimientoCuenta({
      idempresa,
      idcliente: idclienteLimpio,
      idcuenta: cuenta.idcuenta,
      tipo_movimiento: "ABONO",
      valor: valorAbono,
      idmedio_pago: idmedio_pago ? limpiarTexto(idmedio_pago) : null,
      observacion:
        limpiarTexto(observacion) ||
        `Abono registrado en cuenta abierta por valor de ${valorAbono}`,
      creado_por: obtenerIdUsuario(req),
    });

    return res.json({
      success: true,
      message:
        resultado.cuenta.estado === "CERRADA"
          ? "Abono registrado correctamente. La cuenta quedó cerrada porque el saldo llegó a cero."
          : "Abono registrado correctamente",
      cuenta: resultado.cuenta,
      movimiento: resultado.movimiento,
    });
  } catch (error) {
    console.error("❌ Error registrando abono:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error registrando abono",
    });
  }
});

// ================== POST: Ajuste manual ==================

router.post("/ajuste", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);

    const {
      idcliente,
      saldo_nuevo,
      observacion = "",
    } = req.body;

    const idclienteLimpio = normalizarIdEntero(idcliente);
    const nuevoSaldo = normalizarValor(saldo_nuevo);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idclienteLimpio || nuevoSaldo < 0) {
      return res.status(400).json({
        success: false,
        error: "Cliente y saldo nuevo mayor o igual a cero son obligatorios",
      });
    }

    if (!limpiarTexto(observacion)) {
      return res.status(400).json({
        success: false,
        error: "La observación es obligatoria para realizar ajustes",
      });
    }

    const cliente = await obtenerClienteEmpresa(idclienteLimpio, idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    let cuenta = await obtenerCuentaAbiertaPorCliente(idclienteLimpio, idempresa);

    if (!cuenta && nuevoSaldo > 0) {
      cuenta = await crearCuentaAbierta({
        idempresa,
        idcliente: idclienteLimpio,
      });
    }

    if (!cuenta) {
      return res.status(400).json({
        success: false,
        error: "No existe cuenta abierta activa para ajustar",
      });
    }

    const saldoAnterior = normalizarValor(cuenta.saldo_actual);
    const diferencia = normalizarValor(Math.abs(nuevoSaldo - saldoAnterior));

    const resultado = await registrarMovimientoCuenta({
      idempresa,
      idcliente: idclienteLimpio,
      idcuenta: cuenta.idcuenta,
      tipo_movimiento: "AJUSTE",
      valor: diferencia,
      observacion: limpiarTexto(observacion),
      creado_por: obtenerIdUsuario(req),
      saldo_nuevo_forzado: nuevoSaldo,
    });

    return res.json({
      success: true,
      message:
        resultado.cuenta.estado === "CERRADA"
          ? "Ajuste registrado correctamente. La cuenta quedó cerrada porque el saldo llegó a cero."
          : "Ajuste registrado correctamente",
      cuenta: resultado.cuenta,
      movimiento: resultado.movimiento,
    });
  } catch (error) {
    console.error("❌ Error registrando ajuste:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error registrando ajuste",
    });
  }
});

// ================== POST: Cerrar cuenta manualmente ==================

router.post("/:idcuenta/cerrar", async (req, res) => {
  try {
    const idempresa = normalizarIdEmpresa(req);
    const idcuenta = normalizarIdEntero(req.params.idcuenta);

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "No hay empresa activa",
      });
    }

    if (!idcuenta) {
      return res.status(400).json({
        success: false,
        error: "Cuenta inválida",
      });
    }

    const cuenta = await obtenerCuentaPorId(idcuenta, idempresa);

    if (!cuenta) {
      return res.status(404).json({
        success: false,
        error: "Cuenta abierta no encontrada",
      });
    }

    if (cuenta.estado === "CERRADA") {
      return res.json({
        success: true,
        message: "La cuenta ya estaba cerrada",
        cuenta,
      });
    }

    const saldoActual = normalizarValor(cuenta.saldo_actual);

    if (saldoActual > 0) {
      return res.status(400).json({
        success: false,
        error: "No se puede cerrar una cuenta con saldo pendiente",
      });
    }

    const result = await query(
      `
      UPDATE public.cuentas_abiertas
      SET estado = 'CERRADA',
          fecha_cierre = NOW(),
          updatedat = NOW()
      WHERE idcuenta = $1
        AND idempresa = $2
      RETURNING *
      `,
      [idcuenta, idempresa]
    );

    return res.json({
      success: true,
      message: "Cuenta cerrada correctamente",
      cuenta: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error cerrando cuenta abierta:", error);

    return res.status(500).json({
      success: false,
      error: "Error cerrando cuenta abierta",
      detail: error.message,
    });
  }
});

export default router;