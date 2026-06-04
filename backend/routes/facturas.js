// routes/facturas.js
import express from "express";
import { query } from "../db.js";
import axios from "axios";
import { getSiigoToken } from "./siigoAuth.js";
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

function normalizarIdsNumericos(values = []) {
  return [
    ...new Set(
      values
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0)
    ),
  ];
}

function normalizarIdsTexto(values = []) {
  return [
    ...new Set(
      values
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
        .map((v) => String(v).trim())
    ),
  ];
}

function construirObservaciones(observaciones, detallesDB = []) {
  const textoBase =
    'Nota: Servicio Excluido de IVA. Art 476 ET. #29 "Los servicios de promoción y fomento deportivo prestados por los clubes deportivos definidos en el artículo 2 del Decreto Ley 1228 de 1995 "Clubes deportivos. Los clubes deportivos son organismos de derecho privado constituidos por afiliados, mayoritariamente deportistas, para fomentar y patrocinar la práctica de un deporte o modalidad, la recreación y el aprovechamiento del tiempo libre(...)"';

  const observacionesUsuario = limpiarTexto(observaciones)
    ? `🗒️ ${limpiarTexto(observaciones)}`
    : "";

  const observacionesDetalles = detallesDB
    .map((d) => d.descripcion)
    .filter((desc) => desc && String(desc).trim() !== "")
    .join("\n");

  let observacionesFinal = textoBase;

  if (observacionesUsuario || observacionesDetalles) {
    observacionesFinal += "\n\n📋 Detalles adicionales:\n";

    if (observacionesUsuario) {
      observacionesFinal += observacionesUsuario + "\n";
    }

    if (observacionesDetalles) {
      observacionesFinal += observacionesDetalles;
    }
  }

  return observacionesFinal;
}

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

async function obtenerProductosEmpresa(detalles, idempresa) {
  const idsProductos = normalizarIdsNumericos(detalles.map((d) => d.idproducto));

  if (idsProductos.length === 0) {
    return [];
  }

  const result = await query(
    `
    SELECT 
      idproducto,
      codigo,
      nombre,
      precio
    FROM public.productos
    WHERE idempresa = $1
      AND idproducto = ANY($2::int[])
    `,
    [idempresa, idsProductos]
  );

  return result.rows;
}

async function obtenerMediosPagoEmpresa(pagos, idempresa) {
  const idsMedios = normalizarIdsTexto(pagos.map((p) => p.idmedio));

  if (idsMedios.length === 0) {
    return [];
  }

  const result = await query(
    `
    SELECT 
      idmedio,
      idsiigo,
      nombre
    FROM public.medios_pago
    WHERE idempresa = $1
      AND idmedio = ANY($2::text[])
    `,
    [idempresa, idsMedios]
  );

  return result.rows;
}

function recalcularDetalles(detalles, productosMap) {
  return detalles.map((d) => {
    const idproducto = Number(d.idproducto);
    const producto = productosMap[idproducto] || {};

    let precioUnitario = 0;

    // Producto código 011: valor libre.
    if (producto.codigo === "011") {
      precioUnitario = Number(d.valorunitario) || 0;
    } else {
      precioUnitario = Number(producto.precio) || 0;
    }

    const cantidad = Number(d.cantidad || 1);
    const subtotal = precioUnitario * cantidad;

    return {
      ...d,
      idproducto,
      cantidad,
      valorunitario: precioUnitario,
      subtotal,
      descripcion: d.descripcion || null,
    };
  });
}

function buildSiigoStylePayload({
  cliente,
  detalles,
  pagos,
  total,
  observaciones,
  productosMap,
  mediosMap,
}) {
  return {
    document: { id: 27836 },
    date: new Date().toISOString().split("T")[0],
    customer: {
      identification: cliente.identificacion,
      branch_office: 0,
    },
    seller: 258,
    observations: observaciones || "",
    items: detalles.map((d) => {
      const prod = productosMap[d.idproducto] || {};

      return {
        code: prod.codigo || `Item-${d.idproducto}`,
        quantity: Number(d.cantidad),
        price: Number(d.valorunitario),
        description: prod.nombre || "",
      };
    }),
    total: Number(total),
    payments: pagos.map((p) => ({
      id: mediosMap[p.idmedio] || null,
      value: Number(p.valor || 0),
      due_date:
        p.due_date && String(p.due_date).trim() !== ""
          ? p.due_date
          : new Date().toISOString().split("T")[0],
    })),
    stamp: { send: true },
    mail: { send: true },
  };
}

async function registrarDetallesFactura({ idempresa, idfactura, detalles }) {
  for (const d of detalles) {
    await query(
      `
      INSERT INTO public.factura_detalles (
        idempresa,
        idfactura,
        idproducto,
        cantidad,
        valorunitario,
        subtotal,
        descripcion,
        descuento,
        impuesto_id,
        impuesto_valor
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        idempresa,
        idfactura,
        d.idproducto,
        d.cantidad,
        d.valorunitario,
        d.subtotal,
        d.descripcion || null,
        d.descuento || 0,
        d.impuesto_id || null,
        d.impuesto_valor || 0,
      ]
    );
  }
}

async function registrarPagosFactura({ idempresa, idfactura, pagos }) {
  for (const p of pagos) {
    await query(
      `
      INSERT INTO public.factura_pagos (
        idempresa,
        idfactura,
        idmedio,
        valor,
        due_date,
        siigo_pago_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        idempresa,
        idfactura,
        p.idmedio || null,
        Number(p.valor || 0),
        p.due_date && String(p.due_date).trim() !== "" ? p.due_date : null,
        p.siigo_pago_id || null,
      ]
    );
  }
}

async function obtenerDescripcionesDetalles(idfactura, idempresa) {
  const detallesDB = await query(
    `
    SELECT descripcion
    FROM public.factura_detalles
    WHERE idfactura = $1
      AND idempresa = $2
    `,
    [idfactura, idempresa]
  );

  return detallesDB.rows;
}

// ================== SIIGO ==================

async function enviarAFacturaSiigo(siigoPayload, reintentos = 3) {
  let intento = 0;
  let lastError = null;
  let token = await getSiigoToken();

  while (intento < reintentos) {
    try {
      const resp = await axios.post(
        "https://api.siigo.com/v1/invoices",
        siigoPayload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "Partner-Id": process.env.SIIGO_PARTNER,
          },
        }
      );

      return resp.data;
    } catch (err) {
      lastError = err;

      const code = err.response?.data?.Errors?.[0]?.Code;
      const status = err.response?.status;

      if (code === "documents_service" || status === 503) {
        intento++;
        console.warn(
          `⚠️ Servicio de Siigo no disponible (reintento ${intento}/${reintentos})`
        );
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (status === 401) {
        console.warn("🔄 Token expirado, renovando...");
        token = await getSiigoToken();
        intento++;
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

// ================== POST: Crear Factura y enviar a Siigo ==================

router.post("/", async (req, res) => {
  try {
    const {
      idcliente,
      detalles = [],
      pagos = [],
      observaciones = "",
    } = req.body;

    if (!idcliente || !Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cliente y detalles son obligatorios",
      });
    }

    const cliente = await obtenerClienteEmpresa(idcliente, req.idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const idsProductos = normalizarIdsNumericos(detalles.map((d) => d.idproducto));
    const productos = await obtenerProductosEmpresa(detalles, req.idempresa);

    if (productos.length !== idsProductos.length) {
      return res.status(400).json({
        success: false,
        error: "Uno o más productos no pertenecen a la empresa activa",
      });
    }

    const productosMap = Object.fromEntries(
      productos.map((p) => [
        p.idproducto,
        {
          codigo: p.codigo,
          nombre: p.nombre,
          precio: Number(p.precio),
        },
      ])
    );

    const detallesRecalculados = recalcularDetalles(detalles, productosMap);

    const totalFactura = detallesRecalculados.reduce(
      (acc, d) => acc + Number(d.subtotal || 0),
      0
    );

    if (totalFactura <= 0) {
      return res.status(400).json({
        success: false,
        error: "El total de la factura debe ser mayor a cero",
      });
    }

    const idsMedios = normalizarIdsTexto(pagos.map((p) => p.idmedio));
    const medios = await obtenerMediosPagoEmpresa(pagos, req.idempresa);

    if (pagos.length > 0 && medios.length !== idsMedios.length) {
      return res.status(400).json({
        success: false,
        error: "Uno o más medios de pago no pertenecen a la empresa activa",
      });
    }

    const mediosMap = Object.fromEntries(
      medios.map((m) => [m.idmedio, m.idsiigo])
    );

    const resultFactura = await query(
      `
      INSERT INTO public.facturas (
        idempresa,
        idcliente,
        total,
        idusuario,
        estado,
        createdat,
        updatedat
      )
      VALUES ($1, $2, $3, $4, 'PENDIENTE', NOW(), NOW())
      RETURNING *
      `,
      [
        req.idempresa,
        idcliente,
        totalFactura,
        req.user.idusuario,
      ]
    );

    const factura = resultFactura.rows[0];

    await registrarDetallesFactura({
      idempresa: req.idempresa,
      idfactura: factura.idfactura,
      detalles: detallesRecalculados,
    });

    await registrarPagosFactura({
      idempresa: req.idempresa,
      idfactura: factura.idfactura,
      pagos,
    });

    const detallesDB = await obtenerDescripcionesDetalles(
      factura.idfactura,
      req.idempresa
    );

    const observacionesFinal = construirObservaciones(observaciones, detallesDB);

    const totalPagos = pagos.reduce(
      (acc, p) => acc + Number(p.valor || 0),
      0
    );

    const totalGeneral = totalPagos > 0 ? totalPagos : totalFactura;

    const siigoPayload = buildSiigoStylePayload({
      cliente,
      detalles: detallesRecalculados,
      pagos,
      total: totalGeneral,
      observaciones: observacionesFinal,
      productosMap,
      mediosMap,
    });

    console.log("📤 Payload enviado a Siigo:", JSON.stringify(siigoPayload, null, 2));

    let siigoResponseData = null;
    let exito = false;
    let mensaje = "";

    try {
      siigoResponseData = await enviarAFacturaSiigo(siigoPayload, 3);
      exito = true;
      mensaje = "Factura enviada exitosamente a Siigo";

      await query(
        `
        UPDATE public.facturas
        SET siigo_id = $1,
            siigo_number = $2,
            siigo_name = $3,
            public_url = $4,
            cufe = $5,
            estado = 'ENVIADA',
            updatedat = NOW()
        WHERE idfactura = $6
          AND idempresa = $7
        `,
        [
          siigoResponseData.id,
          siigoResponseData.number,
          siigoResponseData.name,
          siigoResponseData.public_url,
          siigoResponseData.stamp?.cufe || null,
          factura.idfactura,
          req.idempresa,
        ]
      );
    } catch (err) {
      const code = err.response?.data?.Errors?.[0]?.Code;

      if (code === "documents_service") {
        console.warn("⚠️ Servicio Siigo inactivo, factura marcada como PENDIENTE_ENVIO");

        await query(
          `
          UPDATE public.facturas
          SET estado = 'PENDIENTE_ENVIO',
              updatedat = NOW()
          WHERE idfactura = $1
            AND idempresa = $2
          `,
          [factura.idfactura, req.idempresa]
        );

        mensaje = "Factura guardada localmente. Siigo está fuera de servicio.";
      } else {
        console.error("❌ Error al enviar a Siigo:", err.response?.data || err.message);
        mensaje = "Error al enviar a Siigo";
      }
    }

    await query(
      `
      INSERT INTO public.factura_logs (
        idfactura,
        payload,
        response,
        exito,
        mensaje
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        factura.idfactura,
        JSON.stringify(siigoPayload),
        JSON.stringify(siigoResponseData || {}),
        exito,
        mensaje,
      ]
    );

    return res.json({
      success: true,
      message: mensaje,
      factura: {
        ...factura,
        total: totalFactura,
      },
      siigo: siigoResponseData || "Factura no enviada",
    });
  } catch (error) {
    console.error("❌ Error creando factura:", error);

    return res.status(500).json({
      success: false,
      error: "Error creando factura",
    });
  }
});

// ================== GET: Listar Facturas ==================

router.get("/", async (req, res) => {
  try {
    const {
      cliente,
      estado,
      page = 1,
      per_page = 10,
    } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const currentPerPage = Math.max(Number(per_page) || 10, 1);
    const offset = (currentPage - 1) * currentPerPage;

    const whereClauses = ["f.idempresa = $1"];
    const params = [req.idempresa];
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
      params.push(`%${cliente}%`);
      idx++;
    }

    if (estado) {
      whereClauses.push(`f.estado = $${idx}`);
      params.push(estado);
      idx++;
    }

    const whereSQL = `WHERE ${whereClauses.join(" AND ")}`;

    const sql = `
      SELECT 
        f.idfactura,
        f.idempresa,
        c.identificacion,
        COALESCE(
          NULLIF(c.razonsocial, ''),
          TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        ) AS nombre_cliente,
        f.total,
        f.estado,
        f.siigo_number,
        f.createdat,
        f.public_url
      FROM public.facturas f
      JOIN public.clientes c 
        ON c.idcliente = f.idcliente
       AND c.idempresa = f.idempresa
      ${whereSQL}
      ORDER BY f.createdat DESC
      LIMIT $${idx}
      OFFSET $${idx + 1}
    `;

    const facturas = await query(sql, [
      ...params,
      currentPerPage,
      offset,
    ]);

    const countSQL = `
      SELECT COUNT(*) AS total
      FROM public.facturas f
      JOIN public.clientes c 
        ON c.idcliente = f.idcliente
       AND c.idempresa = f.idempresa
      ${whereSQL}
    `;

    const count = await query(countSQL, params);
    const total = Number(count.rows[0].total || 0);

    return res.json({
      success: true,
      facturas: facturas.rows,
      page: currentPage,
      per_page: currentPerPage,
      total,
      total_pages: Math.ceil(total / currentPerPage),
    });
  } catch (error) {
    console.error("❌ Error listando facturas:", error);

    return res.status(500).json({
      success: false,
      error: "Error al obtener facturas",
    });
  }
});

// ================== POST: Crear PREFACTURA ==================

router.post("/prefactura", async (req, res) => {
  try {
    const {
      idcliente,
      detalles = [],
      pagos = [],
      observaciones = "",
    } = req.body;

    if (!idcliente || !Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cliente y detalles son obligatorios",
      });
    }

    const cliente = await obtenerClienteEmpresa(idcliente, req.idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const idsProductos = normalizarIdsNumericos(detalles.map((d) => d.idproducto));
    const productos = await obtenerProductosEmpresa(detalles, req.idempresa);

    if (productos.length !== idsProductos.length) {
      return res.status(400).json({
        success: false,
        error: "Uno o más productos no pertenecen a la empresa activa",
      });
    }

    const productosMap = Object.fromEntries(
      productos.map((p) => [
        p.idproducto,
        {
          codigo: p.codigo,
          nombre: p.nombre,
          precio: Number(p.precio),
        },
      ])
    );

    const detallesRecalculados = recalcularDetalles(detalles, productosMap);

    const totalFactura = detallesRecalculados.reduce(
      (acc, d) => acc + Number(d.subtotal || 0),
      0
    );

    if (totalFactura <= 0) {
      return res.status(400).json({
        success: false,
        error: "El total de la prefactura debe ser mayor a cero",
      });
    }

    const idsMedios = normalizarIdsTexto(pagos.map((p) => p.idmedio));
    const mediosPago = await obtenerMediosPagoEmpresa(pagos, req.idempresa);

    if (pagos.length > 0 && mediosPago.length !== idsMedios.length) {
      return res.status(400).json({
        success: false,
        error: "Uno o más medios de pago no pertenecen a la empresa activa",
      });
    }

    const mediosMap = Object.fromEntries(
      mediosPago.map((m) => [m.idmedio, m.idsiigo])
    );

    const resultFactura = await query(
      `
      INSERT INTO public.facturas (
        idempresa,
        idcliente,
        total,
        idusuario,
        estado,
        createdat,
        updatedat
      )
      VALUES ($1, $2, $3, $4, 'PREFACTURA', NOW(), NOW())
      RETURNING *
      `,
      [
        req.idempresa,
        idcliente,
        totalFactura,
        req.user.idusuario,
      ]
    );

    const factura = resultFactura.rows[0];

    await registrarDetallesFactura({
      idempresa: req.idempresa,
      idfactura: factura.idfactura,
      detalles: detallesRecalculados,
    });

    await registrarPagosFactura({
      idempresa: req.idempresa,
      idfactura: factura.idfactura,
      pagos,
    });

    const detallesDB = await obtenerDescripcionesDetalles(
      factura.idfactura,
      req.idempresa
    );

    const observacionesFinal = construirObservaciones(observaciones, detallesDB);

    const siigoStylePayload = buildSiigoStylePayload({
      cliente,
      detalles: detallesRecalculados,
      pagos,
      total: totalFactura,
      observaciones: observacionesFinal,
      productosMap,
      mediosMap,
    });

    await query(
      `
      INSERT INTO public.factura_logs (
        idfactura,
        payload,
        response,
        exito,
        mensaje
      )
      VALUES ($1, $2, '{}', false, 'Prefactura guardada localmente')
      `,
      [factura.idfactura, JSON.stringify(siigoStylePayload)]
    );

    return res.json({
      success: true,
      message: "Prefactura creada correctamente",
      factura: {
        ...factura,
        total: totalFactura,
      },
      siigo: "No enviada",
      payload_preview: siigoStylePayload,
    });
  } catch (error) {
    console.error("❌ Error creando prefactura:", error);

    return res.status(500).json({
      success: false,
      error: "Error creando prefactura",
    });
  }
});

// ================== PUT: Actualizar Prefactura ==================

router.put("/prefactura/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      idcliente,
      detalles = [],
      pagos = [],
      observaciones = "",
      enviar = false,
    } = req.body;

    if (!idcliente || !Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cliente y detalles son obligatorios",
      });
    }

    const facturaResult = await query(
      `
      SELECT *
      FROM public.facturas
      WHERE idfactura = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [id, req.idempresa]
    );

    if (facturaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Prefactura no encontrada",
      });
    }

    const factura = facturaResult.rows[0];

    if (factura.estado !== "PREFACTURA") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden actualizar PREFACTURAS",
      });
    }

    const cliente = await obtenerClienteEmpresa(idcliente, req.idempresa);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado para la empresa activa",
      });
    }

    const idsProductos = normalizarIdsNumericos(detalles.map((d) => d.idproducto));
    const productos = await obtenerProductosEmpresa(detalles, req.idempresa);

    if (productos.length !== idsProductos.length) {
      return res.status(400).json({
        success: false,
        error: "Uno o más productos no pertenecen a la empresa activa",
      });
    }

    const productosMap = Object.fromEntries(
      productos.map((p) => [
        p.idproducto,
        {
          codigo: p.codigo,
          nombre: p.nombre,
          precio: Number(p.precio),
        },
      ])
    );

    const detallesRecalculados = recalcularDetalles(detalles, productosMap);

    const totalFactura = detallesRecalculados.reduce(
      (acc, d) => acc + Number(d.subtotal || 0),
      0
    );

    if (totalFactura <= 0) {
      return res.status(400).json({
        success: false,
        error: "El total de la prefactura debe ser mayor a cero",
      });
    }

    const idsMedios = normalizarIdsTexto(pagos.map((p) => p.idmedio));
    const medios = await obtenerMediosPagoEmpresa(pagos, req.idempresa);

    if (pagos.length > 0 && medios.length !== idsMedios.length) {
      return res.status(400).json({
        success: false,
        error: "Uno o más medios de pago no pertenecen a la empresa activa",
      });
    }

    const mediosMap = Object.fromEntries(
      medios.map((m) => [m.idmedio, m.idsiigo])
    );

    await query(
      `
      UPDATE public.facturas
      SET idcliente = $1,
          total = $2,
          idusuario = $3,
          updatedat = NOW()
      WHERE idfactura = $4
        AND idempresa = $5
      `,
      [
        idcliente,
        totalFactura,
        req.user.idusuario,
        id,
        req.idempresa,
      ]
    );

    await query(
      `
      DELETE FROM public.factura_detalles
      WHERE idfactura = $1
        AND idempresa = $2
      `,
      [id, req.idempresa]
    );

    await query(
      `
      DELETE FROM public.factura_pagos
      WHERE idfactura = $1
        AND idempresa = $2
      `,
      [id, req.idempresa]
    );

    await registrarDetallesFactura({
      idempresa: req.idempresa,
      idfactura: id,
      detalles: detallesRecalculados,
    });

    await registrarPagosFactura({
      idempresa: req.idempresa,
      idfactura: id,
      pagos,
    });

    const detallesDB = await obtenerDescripcionesDetalles(id, req.idempresa);
    const observacionesFinal = construirObservaciones(observaciones, detallesDB);

    const siigoPayload = buildSiigoStylePayload({
      cliente,
      detalles: detallesRecalculados,
      pagos,
      total: totalFactura,
      observaciones: observacionesFinal,
      productosMap,
      mediosMap,
    });

    if (!enviar) {
      await query(
        `
        INSERT INTO public.factura_logs (
          idfactura,
          payload,
          response,
          exito,
          mensaje
        )
        VALUES ($1, $2, '{}', false, 'Prefactura actualizada')
        `,
        [id, JSON.stringify(siigoPayload)]
      );

      return res.json({
        success: true,
        message: "Prefactura actualizada correctamente",
        factura: {
          idfactura: Number(id),
          total: totalFactura,
        },
        siigo: "Sin envío",
        payload_preview: siigoPayload,
      });
    }

    let siigoResponse = null;
    let exito = false;
    let mensaje = "";

    try {
      siigoResponse = await enviarAFacturaSiigo(siigoPayload, 3);
      exito = true;
      mensaje = "Prefactura actualizada y enviada a Siigo";

      await query(
        `
        UPDATE public.facturas
        SET siigo_id = $1,
            siigo_number = $2,
            siigo_name = $3,
            public_url = $4,
            cufe = $5,
            estado = 'ENVIADA',
            updatedat = NOW()
        WHERE idfactura = $6
          AND idempresa = $7
        `,
        [
          siigoResponse.id,
          siigoResponse.number,
          siigoResponse.name,
          siigoResponse.public_url,
          siigoResponse.stamp?.cufe || null,
          id,
          req.idempresa,
        ]
      );
    } catch (error) {
      console.error(
        "❌ Error enviando prefactura a Siigo:",
        error.response?.data || error.message
      );

      await query(
        `
        UPDATE public.facturas
        SET estado = 'PENDIENTE_ENVIO',
            updatedat = NOW()
        WHERE idfactura = $1
          AND idempresa = $2
        `,
        [id, req.idempresa]
      );

      mensaje = "Prefactura actualizada, pero quedó pendiente de envío a Siigo";
    }

    await query(
      `
      INSERT INTO public.factura_logs (
        idfactura,
        payload,
        response,
        exito,
        mensaje
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        id,
        JSON.stringify(siigoPayload),
        JSON.stringify(siigoResponse || {}),
        exito,
        mensaje,
      ]
    );

    return res.json({
      success: true,
      message: mensaje,
      factura: {
        idfactura: Number(id),
        total: totalFactura,
      },
      siigo: siigoResponse,
    });
  } catch (error) {
    console.error("❌ Error actualizando prefactura:", error);

    return res.status(500).json({
      success: false,
      error: "Error actualizando prefactura",
    });
  }
});

// ================== GET: Obtener Factura por ID ==================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const facturaSQL = `
      SELECT 
        f.idfactura,
        f.idempresa,
        f.idcliente,
        f.total,
        f.estado,
        f.createdat,
        f.updatedat,
        f.idusuario,
        f.siigo_id,
        f.siigo_number,
        f.siigo_name,
        f.public_url,
        f.cufe,
        c.identificacion,
        COALESCE(
          NULLIF(c.razonsocial, ''),
          TRIM(COALESCE(c.nombres, '') || ' ' || COALESCE(c.apellidos, ''))
        ) AS nombre_cliente,
        c.nombres,
        c.apellidos,
        c.razonsocial
      FROM public.facturas f
      JOIN public.clientes c 
        ON c.idcliente = f.idcliente
       AND c.idempresa = f.idempresa
      WHERE f.idfactura = $1
        AND f.idempresa = $2
      LIMIT 1
    `;

    const facturaResult = await query(facturaSQL, [id, req.idempresa]);

    if (facturaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Factura no encontrada",
      });
    }

    const factura = facturaResult.rows[0];

    const detallesSQL = `
      SELECT 
        d.iddetalle,
        d.idempresa,
        d.idfactura,
        d.idproducto,
        p.codigo,
        p.nombre,
        d.cantidad,
        d.valorunitario,
        d.subtotal,
        d.descripcion,
        d.descuento,
        d.impuesto_id,
        d.impuesto_valor
      FROM public.factura_detalles d
      LEFT JOIN public.productos p 
        ON p.idproducto = d.idproducto
       AND p.idempresa = d.idempresa
      WHERE d.idfactura = $1
        AND d.idempresa = $2
      ORDER BY d.iddetalle ASC
    `;

    const detalles = (await query(detallesSQL, [id, req.idempresa])).rows;

    const pagosSQL = `
      SELECT 
        fp.idfacturapago,
        fp.idempresa,
        fp.idfactura,
        fp.idmedio,
        m.nombre AS medio,
        fp.valor,
        fp.createdat,
        fp.due_date,
        fp.siigo_pago_id
      FROM public.factura_pagos fp
      LEFT JOIN public.medios_pago m 
        ON m.idmedio = fp.idmedio
       AND m.idempresa = fp.idempresa
      WHERE fp.idfactura = $1
        AND fp.idempresa = $2
      ORDER BY fp.idfacturapago ASC
    `;

    const pagos = (await query(pagosSQL, [id, req.idempresa])).rows;

    return res.json({
      success: true,
      ...factura,
      cliente: {
        idcliente: factura.idcliente,
        nombre_cliente: factura.nombre_cliente,
        nombres: factura.nombres,
        apellidos: factura.apellidos,
        razonsocial: factura.razonsocial,
        identificacion: factura.identificacion,
      },
      detalles,
      pagos,
    });
  } catch (error) {
    console.error("❌ Error consultando factura:", error);

    return res.status(500).json({
      success: false,
      error: "Error consultando factura",
    });
  }
});

export default router;