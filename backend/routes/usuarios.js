// routes/usuarios.js
import express from "express";
import { query } from "../db.js";
import bcrypt from "bcrypt";

const router = express.Router();

// =====================================================
// RUTA PÚBLICA: bootstrap
// =====================================================
router.post("/bootstrap", async (req, res) => {
  // código para crear primer usuario
});


// ================== GET: Listar usuarios ==================
router.get("/", async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        u.idusuario,
        u.nombrecompleto,
        u.username,
        u.rol,
        u.email,
        u.activo,
        u.createdat,
        u.updatedat,

        ue.idusuario_empresa,
        ue.idempresa,
        ue.rol_empresa,
        ue.activo AS usuario_empresa_activo,
        ue.es_predeterminada,

        e.nombre AS empresa_nombre,
        e.nit AS empresa_nit,
        e.razon_social AS empresa_razon_social
      FROM usuarios u
      LEFT JOIN usuario_empresa ue 
        ON ue.idusuario = u.idusuario
       AND ue.es_predeterminada = true
      LEFT JOIN empresas e 
        ON e.idempresa = ue.idempresa
      ORDER BY u.idusuario ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error obteniendo usuarios:", error);

    res.status(500).json({
      error: "Error obteniendo usuarios",
      detalle: error.message
    });
  }
});

// ================== POST: Crear primer usuario administrador ==================
router.post("/bootstrap", async (req, res) => {
  try {
    const {
      nombrecompleto,
      username,
      passwordhash,
      email,
      idempresa
    } = req.body;

    if (!nombrecompleto || !username || !passwordhash || !idempresa) {
      return res.status(400).json({
        success: false,
        error: "Nombre completo, username, contraseña e idempresa son obligatorios"
      });
    }

    const totalUsuariosResult = await query(`
      SELECT COUNT(*)::int AS total
      FROM usuarios
    `);

    const totalUsuarios = totalUsuariosResult.rows[0].total;

    if (totalUsuarios > 0) {
      return res.status(403).json({
        success: false,
        error: "Bootstrap deshabilitado. Ya existen usuarios en el sistema."
      });
    }

    const empresaResult = await query(
      `
      SELECT idempresa
      FROM empresas
      WHERE idempresa = $1
        AND activo = true
      `,
      [idempresa]
    );

    if (empresaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "La empresa indicada no existe o está inactiva"
      });
    }

    const hashedPassword = await bcrypt.hash(passwordhash, 10);

    await query("BEGIN");

    try {
      const usuarioResult = await query(
        `
        INSERT INTO usuarios (
          nombrecompleto,
          username,
          passwordhash,
          rol,
          email,
          activo,
          createdat,
          updatedat
        )
        VALUES ($1, LOWER($2), $3, 'ADMIN', $4, true, NOW(), NOW())
        RETURNING 
          idusuario,
          nombrecompleto,
          username,
          rol,
          email,
          activo,
          createdat,
          updatedat
        `,
        [
          nombrecompleto,
          username,
          hashedPassword,
          email || null
        ]
      );

      const usuario = usuarioResult.rows[0];

      const usuarioEmpresaResult = await query(
        `
        INSERT INTO usuario_empresa (
          idusuario,
          idempresa,
          rol_empresa,
          activo,
          es_predeterminada,
          createdat,
          updatedat
        )
        VALUES ($1, $2, 'ADMIN', true, true, NOW(), NOW())
        RETURNING *
        `,
        [
          usuario.idusuario,
          idempresa
        ]
      );

      await query("COMMIT");

      return res.status(201).json({
        success: true,
        mensaje: "Usuario administrador inicial creado correctamente",
        usuario,
        usuario_empresa: usuarioEmpresaResult.rows[0]
      });

    } catch (transactionError) {
      await query("ROLLBACK");
      throw transactionError;
    }

  } catch (error) {
    console.error("❌ Error creando usuario bootstrap:", error);

    return res.status(500).json({
      success: false,
      error: "Error creando usuario bootstrap",
      detalle: error.message
    });
  }
});

// ================== GET: Usuario por ID ==================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT 
        u.idusuario,
        u.nombrecompleto,
        u.username,
        u.rol,
        u.email,
        u.activo,
        u.createdat,
        u.updatedat,

        ue.idusuario_empresa,
        ue.idempresa,
        ue.rol_empresa,
        ue.activo AS usuario_empresa_activo,
        ue.es_predeterminada,

        e.nombre AS empresa_nombre,
        e.nit AS empresa_nit,
        e.razon_social AS empresa_razon_social
      FROM usuarios u
      LEFT JOIN usuario_empresa ue 
        ON ue.idusuario = u.idusuario
       AND ue.es_predeterminada = true
      LEFT JOIN empresas e 
        ON e.idempresa = ue.idempresa
      WHERE u.idusuario = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Usuario no encontrado"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo usuario:", error);

    res.status(500).json({
      error: "Error obteniendo usuario",
      detalle: error.message
    });
  }
});

// ================== POST: Crear usuario ==================
router.post("/", async (req, res) => {
  try {
    const {
      nombrecompleto,
      username,
      passwordhash,
      rol,
      email,
      idempresa,
      rol_empresa
    } = req.body;

    if (!nombrecompleto || !username || !passwordhash || !idempresa) {
      return res.status(400).json({
        error: "Nombre completo, username, contraseña e idempresa son obligatorios"
      });
    }

    // Validar empresa activa
    const empresaResult = await query(
      `
      SELECT idempresa, nombre
      FROM empresas
      WHERE idempresa = $1
        AND activo = true
      `,
      [idempresa]
    );

    if (empresaResult.rows.length === 0) {
      return res.status(404).json({
        error: "La empresa indicada no existe o está inactiva"
      });
    }

    // Validar username duplicado
    const usernameResult = await query(
      `
      SELECT idusuario
      FROM usuarios
      WHERE LOWER(username) = LOWER($1)
      `,
      [username]
    );

    if (usernameResult.rows.length > 0) {
      return res.status(409).json({
        error: "Ya existe un usuario con ese username"
      });
    }

    // Validar email duplicado si viene informado
    if (email) {
      const emailResult = await query(
        `
        SELECT idusuario
        FROM usuarios
        WHERE LOWER(email) = LOWER($1)
        `,
        [email]
      );

      if (emailResult.rows.length > 0) {
        return res.status(409).json({
          error: "Ya existe un usuario con ese email"
        });
      }
    }

    await query("BEGIN");

    try {
      const hashedPassword = await bcrypt.hash(passwordhash, 10);

      const usuarioResult = await query(
        `
        INSERT INTO usuarios (
          nombrecompleto,
          username,
          passwordhash,
          rol,
          email,
          activo,
          createdat,
          updatedat
        )
        VALUES ($1, LOWER($2), $3, $4, $5, true, NOW(), NOW())
        RETURNING 
          idusuario,
          nombrecompleto,
          username,
          rol,
          email,
          activo,
          createdat,
          updatedat
        `,
        [
          nombrecompleto,
          username,
          hashedPassword,
          rol || "CAJERO",
          email || null
        ]
      );

      const usuario = usuarioResult.rows[0];

      const usuarioEmpresaResult = await query(
        `
        INSERT INTO usuario_empresa (
          idusuario,
          idempresa,
          rol_empresa,
          activo,
          es_predeterminada,
          createdat,
          updatedat
        )
        VALUES ($1, $2, $3, true, true, NOW(), NOW())
        RETURNING *
        `,
        [
          usuario.idusuario,
          idempresa,
          rol_empresa || rol || "CAJERO"
        ]
      );

      await query("COMMIT");

      res.status(201).json({
        mensaje: "Usuario creado y asociado a la empresa correctamente",
        usuario,
        usuario_empresa: usuarioEmpresaResult.rows[0]
      });

    } catch (transactionError) {
      await query("ROLLBACK");
      throw transactionError;
    }

  } catch (error) {
    console.error("❌ Error creando usuario:", error);

    res.status(500).json({
      error: "Error creando usuario",
      detalle: error.message
    });
  }
});

// ================== PUT: Actualizar usuario ==================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    let {
      nombrecompleto,
      username,
      passwordhash,
      rol,
      email,
      activo,
      idempresa,
      rol_empresa,
      es_predeterminada
    } = req.body;

    const usuarioActualResult = await query(
      `
      SELECT *
      FROM usuarios
      WHERE idusuario = $1
      `,
      [id]
    );

    if (usuarioActualResult.rows.length === 0) {
      return res.status(404).json({
        error: "Usuario no encontrado"
      });
    }

    const usuarioActual = usuarioActualResult.rows[0];

    // Validar username duplicado en otro usuario
    if (username) {
      const usernameResult = await query(
        `
        SELECT idusuario
        FROM usuarios
        WHERE LOWER(username) = LOWER($1)
          AND idusuario <> $2
        `,
        [username, id]
      );

      if (usernameResult.rows.length > 0) {
        return res.status(409).json({
          error: "Ya existe otro usuario con ese username"
        });
      }
    }

    // Validar email duplicado en otro usuario
    if (email) {
      const emailResult = await query(
        `
        SELECT idusuario
        FROM usuarios
        WHERE LOWER(email) = LOWER($1)
          AND idusuario <> $2
        `,
        [email, id]
      );

      if (emailResult.rows.length > 0) {
        return res.status(409).json({
          error: "Ya existe otro usuario con ese email"
        });
      }
    }

    // Validar empresa si viene idempresa
    if (idempresa) {
      const empresaResult = await query(
        `
        SELECT idempresa
        FROM empresas
        WHERE idempresa = $1
          AND activo = true
        `,
        [idempresa]
      );

      if (empresaResult.rows.length === 0) {
        return res.status(404).json({
          error: "La empresa indicada no existe o está inactiva"
        });
      }
    }

    // Mantener contraseña anterior si no se envía nueva
    if (passwordhash) {
      passwordhash = await bcrypt.hash(passwordhash, 10);
    } else {
      passwordhash = usuarioActual.passwordhash;
    }

    await query("BEGIN");

    try {
      const usuarioResult = await query(
        `
        UPDATE usuarios
        SET 
          nombrecompleto = $1,
          username = LOWER($2),
          passwordhash = $3,
          rol = $4,
          email = $5,
          activo = $6,
          updatedat = NOW()
        WHERE idusuario = $7
        RETURNING 
          idusuario,
          nombrecompleto,
          username,
          rol,
          email,
          activo,
          createdat,
          updatedat
        `,
        [
          nombrecompleto ?? usuarioActual.nombrecompleto,
          username ?? usuarioActual.username,
          passwordhash,
          rol ?? usuarioActual.rol,
          email ?? usuarioActual.email,
          activo ?? usuarioActual.activo,
          id
        ]
      );

      let usuarioEmpresa = null;

      if (idempresa) {
        // Si cambia empresa predeterminada, primero quitar predeterminada anterior
        if (es_predeterminada === true || es_predeterminada === undefined) {
          await query(
            `
            UPDATE usuario_empresa
            SET es_predeterminada = false,
                updatedat = NOW()
            WHERE idusuario = $1
            `,
            [id]
          );
        }

        const relacionActualResult = await query(
          `
          SELECT idusuario_empresa
          FROM usuario_empresa
          WHERE idusuario = $1
            AND idempresa = $2
          `,
          [id, idempresa]
        );

        if (relacionActualResult.rows.length > 0) {
          const updateRelacionResult = await query(
            `
            UPDATE usuario_empresa
            SET 
              rol_empresa = $1,
              activo = true,
              es_predeterminada = $2,
              updatedat = NOW()
            WHERE idusuario = $3
              AND idempresa = $4
            RETURNING *
            `,
            [
              rol_empresa || rol || usuarioActual.rol || "CAJERO",
              es_predeterminada === undefined ? true : es_predeterminada,
              id,
              idempresa
            ]
          );

          usuarioEmpresa = updateRelacionResult.rows[0];
        } else {
          const insertRelacionResult = await query(
            `
            INSERT INTO usuario_empresa (
              idusuario,
              idempresa,
              rol_empresa,
              activo,
              es_predeterminada,
              createdat,
              updatedat
            )
            VALUES ($1, $2, $3, true, $4, NOW(), NOW())
            RETURNING *
            `,
            [
              id,
              idempresa,
              rol_empresa || rol || usuarioActual.rol || "CAJERO",
              es_predeterminada === undefined ? true : es_predeterminada
            ]
          );

          usuarioEmpresa = insertRelacionResult.rows[0];
        }
      } else if (rol_empresa) {
        // Actualizar rol en empresa predeterminada si no se envía idempresa
        const updateRelacionResult = await query(
          `
          UPDATE usuario_empresa
          SET 
            rol_empresa = $1,
            updatedat = NOW()
          WHERE idusuario = $2
            AND es_predeterminada = true
          RETURNING *
          `,
          [rol_empresa, id]
        );

        usuarioEmpresa = updateRelacionResult.rows[0] || null;
      }

      await query("COMMIT");

      res.json({
        mensaje: "Usuario actualizado correctamente",
        usuario: usuarioResult.rows[0],
        usuario_empresa: usuarioEmpresa
      });

    } catch (transactionError) {
      await query("ROLLBACK");
      throw transactionError;
    }

  } catch (error) {
    console.error("❌ Error actualizando usuario:", error);

    res.status(500).json({
      error: "Error actualizando usuario",
      detalle: error.message
    });
  }
});

// ================== DELETE: Eliminar usuario ==================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await query("BEGIN");

    try {
      // Primero eliminar relaciones con empresas
      await query(
        `
        DELETE FROM usuario_empresa
        WHERE idusuario = $1
        `,
        [id]
      );

      // Luego eliminar usuario
      const result = await query(
        `
        DELETE FROM usuarios
        WHERE idusuario = $1
        RETURNING 
          idusuario,
          nombrecompleto,
          username,
          rol,
          email,
          activo,
          createdat,
          updatedat
        `,
        [id]
      );

      if (result.rows.length === 0) {
        await query("ROLLBACK");

        return res.status(404).json({
          error: "Usuario no encontrado"
        });
      }

      await query("COMMIT");

      res.json({
        mensaje: "Usuario eliminado correctamente",
        usuario: result.rows[0]
      });

    } catch (transactionError) {
      await query("ROLLBACK");
      throw transactionError;
    }

  } catch (error) {
    console.error("❌ Error eliminando usuario:", error);

    res.status(500).json({
      error: "Error eliminando usuario",
      detalle: error.message
    });
  }
});

export default router;