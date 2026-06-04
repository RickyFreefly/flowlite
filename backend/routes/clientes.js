// routes/clientes.js
import express from "express";
import { query } from "../db.js";
import axios from "axios";
import dotenv from "dotenv";
import { getSiigoToken } from "./siigoAuth.js";
import { authJwt } from "./authJwt.js";
import { companyAccess } from "./companyAccess.js";

dotenv.config();

const router = express.Router();

/**
 * Todas las rutas de clientes quedan protegidas por:
 * 1. authJwt: valida el usuario autenticado.
 * 2. companyAccess: valida que el usuario tenga acceso a la empresa enviada en x-empresa-id.
 */
router.use(authJwt, companyAccess);

// ====== GET: Todos los clientes o por identificación ======
router.get("/", async (req, res) => {
  try {
    const { identificacion } = req.query;

    let result;

    if (identificacion) {
      result = await query(
        `
        SELECT *
        FROM public.clientes
        WHERE idempresa = $1
          AND identificacion ILIKE $2
        ORDER BY idcliente DESC
        `,
        [req.idempresa, `%${identificacion}%`]
      );
    } else {
      result = await query(
        `
        SELECT *
        FROM public.clientes
        WHERE idempresa = $1
        ORDER BY idcliente DESC
        `,
        [req.idempresa]
      );
    }

    return res.json(result.rows);
  } catch (error) {
    console.error("❌ Error en GET /clientes:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener clientes",
    });
  }
});

// ====== GET: Cliente por id ======
router.get("/:idCliente", async (req, res) => {
  try {
    const { idCliente } = req.params;

    const result = await query(
      `
      SELECT *
      FROM public.clientes
      WHERE idcliente = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [idCliente, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error en GET /clientes/:idCliente:", error);
    return res.status(500).json({
      success: false,
      error: "Error al obtener cliente",
    });
  }
});

// ====== POST: Crear cliente (BD + Siigo + Log) ======
router.post("/", async (req, res) => {
  const tipo_local = req.body.tipo;
  const person_type = tipo_local === "JURIDICA" ? "Company" : "Person";

  const {
    id_type,
    identificacion,
    check_digit,
    nombres,
    apellidos,
    razonsocial,
    direccion,
    country_code,
    state_code,
    city_code,
    postal_code,
    telefono,
    indicative,
    extension,
    contact_email,
    observacion,
    fiscal_responsibility,
  } = req.body;

  let finalContactFirstName;
  let finalContactLastName;

  if (tipo_local === "NATURAL") {
    finalContactFirstName = nombres || "NA";
    finalContactLastName = apellidos || "NA";
  } else {
    finalContactFirstName = razonsocial || "NA";
    finalContactLastName = "NA";
  }

  let idCliente = null;
  let siigoResponseData = null;
  let exito = false;
  let mensaje = "";

  try {
    if (!identificacion) {
      return res.status(400).json({
        success: false,
        error: "La identificación del cliente es obligatoria",
      });
    }

    // 1️⃣ Insertar o actualizar cliente localmente, aislado por empresa
    const check = await query(
      `
      SELECT *
      FROM public.clientes
      WHERE idempresa = $1
        AND identificacion = $2
      LIMIT 1
      `,
      [req.idempresa, identificacion]
    );

    if (check.rows.length > 0) {
      idCliente = check.rows[0].idcliente;

      await query(
        `
        UPDATE public.clientes SET 
          tipo_local = $1,
          person_type = $2,
          id_type = $3,
          check_digit = $4,
          nombres = $5,
          apellidos = $6,
          razonsocial = $7,
          direccion = $8,
          country_code = $9,
          state_code = $10,
          city_code = $11,
          postal_code = $12,
          telefono = $13,
          indicative = $14,
          "extension" = $15,
          email = $16,
          contact_first_name = $17,
          contact_last_name = $18,
          contact_email = $19,
          observacion = $20,
          fiscal_responsibility = $21,
          idusuario = $22,
          updatedat = NOW()
        WHERE idcliente = $23
          AND idempresa = $24
        `,
        [
          tipo_local,
          person_type,
          id_type,
          check_digit,
          nombres,
          apellidos,
          razonsocial,
          direccion,
          country_code || "CO",
          state_code || "11",
          city_code || "11001",
          postal_code || "00000",
          telefono,
          indicative || "57",
          extension,
          contact_email,
          finalContactFirstName,
          finalContactLastName,
          contact_email,
          observacion,
          fiscal_responsibility || "R-99-PN",
          req.user.idusuario,
          idCliente,
          req.idempresa,
        ]
      );

      mensaje = "Cliente actualizado localmente";
    } else {
      const insert = await query(
        `
        INSERT INTO public.clientes (
          idempresa,
          tipo_local,
          person_type,
          id_type,
          identificacion,
          check_digit,
          nombres,
          apellidos,
          razonsocial,
          direccion,
          country_code,
          state_code,
          city_code,
          postal_code,
          telefono,
          indicative,
          "extension",
          email,
          contact_first_name,
          contact_last_name,
          contact_email,
          observacion,
          fiscal_responsibility,
          idusuario,
          createdat,
          updatedat
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,NOW(),NOW()
        )
        RETURNING idcliente
        `,
        [
          req.idempresa,
          tipo_local,
          person_type,
          id_type,
          identificacion,
          check_digit,
          nombres,
          apellidos,
          razonsocial,
          direccion,
          country_code || "CO",
          state_code || "11",
          city_code || "11001",
          postal_code || "00000",
          telefono,
          indicative || "57",
          extension,
          contact_email,
          finalContactFirstName,
          finalContactLastName,
          contact_email,
          observacion,
          fiscal_responsibility || "R-99-PN",
          req.user.idusuario,
        ]
      );

      idCliente = insert.rows[0].idcliente;
      mensaje = "Cliente creado localmente";
    }

    // 2️⃣ Construir payload para Siigo
    let siigoBody;

    if (person_type === "Company") {
      siigoBody = {
        person_type: "Company",
        id_type,
        identification: identificacion,
        check_digit: check_digit || null,
        name: [razonsocial],
        fiscal_responsibilities: [{ code: fiscal_responsibility || "R-99-PN" }],
        address: {
          address: direccion,
          city: {
            country_code: country_code || "CO",
            state_code: state_code || "11",
            city_code: city_code || "11001",
          },
        },
        contacts: [
          {
            email: contact_email,
          },
        ],
      };
    } else {
      siigoBody = {
        person_type: "Person",
        id_type,
        identification: identificacion,
        check_digit: check_digit || null,
        name: [nombres, apellidos],
        fiscal_responsibilities: [{ code: fiscal_responsibility || "R-99-PN" }],
        address: {
          address: direccion,
          city: {
            country_code: country_code || "CO",
            state_code: state_code || "11",
            city_code: city_code || "11001",
          },
        },
        contacts: [
          {
            first_name: nombres,
            last_name: apellidos,
            email: contact_email,
          },
        ],
      };
    }

    console.log("📤 Payload cliente enviado a Siigo:", JSON.stringify(siigoBody, null, 2));

    // 3️⃣ Enviar cliente a Siigo
    const token = await getSiigoToken();

    const response = await axios.post("https://api.siigo.com/v1/customers", siigoBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Partner-Id": process.env.SIIGO_PARTNER || "SiigoAPI",
      },
    });

    siigoResponseData = response.data;
    exito = true;
    mensaje = "Cliente sincronizado correctamente con Siigo";

    await query(
      `
      UPDATE public.clientes
      SET siigoid = $1,
          siigocustomerid = $2,
          updatedat = NOW()
      WHERE idcliente = $3
        AND idempresa = $4
      `,
      [
        siigoResponseData.id,
        siigoResponseData.id_str || null,
        idCliente,
        req.idempresa,
      ]
    );

    // 4️⃣ Guardar log
    await query(
      `
      INSERT INTO cliente_logs (
        idcliente,
        payload,
        response,
        exito,
        mensaje
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        idCliente,
        JSON.stringify(siigoBody),
        JSON.stringify(siigoResponseData),
        exito,
        mensaje,
      ]
    );

    return res.status(201).json({
      success: true,
      idCliente,
      siigo: siigoResponseData,
      mensaje,
    });
  } catch (error) {
    console.error("❌ Error en POST /clientes:", error.response?.data || error.message);

    mensaje = "Error al crear o sincronizar cliente";

    try {
      await query(
        `
        INSERT INTO cliente_logs (
          idcliente,
          payload,
          response,
          exito,
          mensaje
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          idCliente,
          JSON.stringify(req.body),
          JSON.stringify(error.response?.data || { error: error.message }),
          false,
          mensaje,
        ]
      );
    } catch (logError) {
      console.error("❌ Error guardando log de cliente:", logError.message);
    }

    return res.status(500).json({
      success: false,
      error: mensaje,
      detail: error.response?.data || error.message,
    });
  }
});

// ====== PUT: Actualizar cliente (BD + Siigo + Log) ======
router.put("/:idCliente", async (req, res) => {
  let siigoResponseData = null;
  let exito = false;
  let mensaje = "";

  try {
    const { idCliente } = req.params;

    const result = await query(
      `
      SELECT *
      FROM public.clientes
      WHERE idcliente = $1
        AND idempresa = $2
      LIMIT 1
      `,
      [idCliente, req.idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cliente no encontrado",
      });
    }

    const cliente = result.rows[0];

    const tipo_local = req.body.tipo || cliente.tipo_local;
    const person_type = tipo_local === "JURIDICA" ? "Company" : "Person";

    let finalContactFirstName;
    let finalContactLastName;

    if (tipo_local === "NATURAL") {
      finalContactFirstName = req.body.nombres || cliente.nombres || "NA";
      finalContactLastName = req.body.apellidos || cliente.apellidos || "NA";
    } else {
      finalContactFirstName = req.body.razonsocial || cliente.razonsocial || "NA";
      finalContactLastName = "NA";
    }

    await query(
      `
      UPDATE public.clientes SET 
        tipo_local = $1,
        person_type = $2,
        id_type = $3,
        nombres = $4,
        apellidos = $5,
        razonsocial = $6,
        direccion = $7,
        country_code = $8,
        state_code = $9,
        city_code = $10,
        postal_code = $11,
        telefono = $12,
        indicative = $13,
        "extension" = $14,
        email = $15,
        contact_first_name = $16,
        contact_last_name = $17,
        contact_email = $18,
        observacion = $19,
        fiscal_responsibility = $20,
        idusuario = $21,
        updatedat = NOW()
      WHERE idcliente = $22
        AND idempresa = $23
      `,
      [
        tipo_local,
        person_type,
        req.body.id_type || cliente.id_type,
        req.body.nombres || cliente.nombres,
        req.body.apellidos || cliente.apellidos,
        req.body.razonsocial || cliente.razonsocial,
        req.body.direccion || cliente.direccion,
        req.body.country_code || cliente.country_code || "CO",
        req.body.state_code || cliente.state_code || "11",
        req.body.city_code || cliente.city_code || "11001",
        req.body.postal_code || cliente.postal_code || "00000",
        req.body.telefono || cliente.telefono,
        req.body.indicative || cliente.indicative || "57",
        req.body.extension || cliente.extension,
        req.body.contact_email || cliente.contact_email,
        finalContactFirstName,
        finalContactLastName,
        req.body.contact_email || cliente.contact_email,
        req.body.observacion || cliente.observacion,
        req.body.fiscal_responsibility || cliente.fiscal_responsibility || "R-99-PN",
        req.user.idusuario,
        idCliente,
        req.idempresa,
      ]
    );

    const siigoBody = {
      person_type,
      id_type: req.body.id_type || cliente.id_type,
      identification: cliente.identificacion,
      fiscal_responsibilities: [
        {
          code:
            req.body.fiscal_responsibility ||
            cliente.fiscal_responsibility ||
            "R-99-PN",
        },
      ],
      address: {
        address: req.body.direccion || cliente.direccion,
        city: {
          country_code: req.body.country_code || cliente.country_code || "CO",
          state_code: req.body.state_code || cliente.state_code || "11",
          city_code: req.body.city_code || cliente.city_code || "11001",
        },
      },
      contacts: [
        {
          first_name: finalContactFirstName,
          last_name: finalContactLastName,
          email: req.body.contact_email || cliente.contact_email,
        },
      ],
      name:
        person_type === "Company"
          ? [req.body.razonsocial || cliente.razonsocial]
          : [
              req.body.nombres || cliente.nombres,
              req.body.apellidos || cliente.apellidos,
            ],
    };

    console.log("📤 Payload actualización cliente enviado a Siigo:", JSON.stringify(siigoBody, null, 2));

    if (!cliente.siigocustomerid) {
      return res.status(400).json({
        success: false,
        error: "El cliente no tiene siigocustomerid para actualizar en Siigo",
      });
    }

    const token = await getSiigoToken();

    const response = await axios.put(
      `https://api.siigo.com/v1/customers/${cliente.siigocustomerid}`,
      siigoBody,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Partner-Id": process.env.SIIGO_PARTNER || "SiigoAPI",
        },
      }
    );

    siigoResponseData = response.data;
    exito = true;
    mensaje = "Cliente actualizado correctamente en Siigo";

    await query(
      `
      INSERT INTO cliente_logs (
        idcliente,
        payload,
        response,
        exito,
        mensaje
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        idCliente,
        JSON.stringify(siigoBody),
        JSON.stringify(siigoResponseData),
        exito,
        mensaje,
      ]
    );

    return res.json({
      success: true,
      idCliente,
      siigoResponse: siigoResponseData,
      mensaje,
    });
  } catch (error) {
    console.error("❌ Error en PUT /clientes/:idCliente:", error.response?.data || error.message);

    mensaje = "Error al actualizar cliente";

    try {
      await query(
        `
        INSERT INTO cliente_logs (
          idcliente,
          payload,
          response,
          exito,
          mensaje
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          req.params.idCliente,
          JSON.stringify(req.body),
          JSON.stringify(error.response?.data || { error: error.message }),
          false,
          mensaje,
        ]
      );
    } catch (logError) {
      console.error("❌ Error guardando log de cliente:", logError.message);
    }

    return res.status(500).json({
      success: false,
      error: mensaje,
      detail: error.response?.data || error.message,
    });
  }
});

export default router;