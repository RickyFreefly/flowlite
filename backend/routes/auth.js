// routes/auth.js
import express from "express";
import { query } from "../db.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { authJwt } from "./authJwt.js";

const router = express.Router();

// ================== Función: obtener empresas del usuario ==================
async function obtenerEmpresasUsuario(idusuario) {
  const result = await query(
    `
    SELECT 
      e.idempresa,
      e.nombre,
      e.nit,
      e.razon_social,
      e.email,
      ue.rol_empresa,
      ue.es_predeterminada
    FROM usuario_empresa ue
    INNER JOIN empresas e ON e.idempresa = ue.idempresa
    WHERE ue.idusuario = $1
      AND ue.activo = TRUE
      AND e.activo = TRUE
    ORDER BY ue.es_predeterminada DESC, e.nombre ASC
    `,
    [idusuario]
  );

  return result.rows;
}

// ================== POST: Login ==================
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const usernameLimpio = String(username || "").trim().toLowerCase();
    const passwordLimpio = String(password || "").trim();

    if (!usernameLimpio || !passwordLimpio) {
      return res.status(400).json({
        success: false,
        message: "Usuario y contraseña son obligatorios",
      });
    }

    const result = await query(
      `
      SELECT 
        idusuario,
        nombrecompleto,
        username,
        passwordhash,
        rol,
        email,
        activo
      FROM usuarios
      WHERE LOWER(username) = $1
        AND activo = TRUE
      LIMIT 1
      `,
      [usernameLimpio]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Usuario no encontrado o inactivo",
      });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(passwordLimpio, user.passwordhash);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Contraseña incorrecta",
      });
    }

    const empresas = await obtenerEmpresasUsuario(user.idusuario);

    if (empresas.length === 0) {
      return res.status(403).json({
        success: false,
        message: "El usuario no tiene empresas asociadas",
      });
    }

    const empresaPredeterminada =
      empresas.find((empresa) => empresa.es_predeterminada) || empresas[0];

    const token = jwt.sign(
      {
        idusuario: user.idusuario,
        id: user.idusuario, // compatibilidad con rutas antiguas
        username: user.username,
        rol: user.rol,
      },
      process.env.JWT_SECRET || "mi_secreto_jwt",
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1h",
      }
    );

    return res.json({
      success: true,
      message: "Login exitoso",
      token,
      user: {
        id: user.idusuario,
        idusuario: user.idusuario,
        username: user.username,
        nombre: user.nombrecompleto,
        rol: user.rol,
        email: user.email,
      },
      empresas,
      empresa_actual: empresaPredeterminada,
    });
  } catch (error) {
    console.error("❌ Error en login:", error);

    return res.status(500).json({
      success: false,
      message: "Error en servidor",
    });
  }
});

// ================== GET: Validar sesión ==================
router.get("/me", authJwt, async (req, res) => {
  try {
    const idusuario = req.user.idusuario || req.user.id;

    const result = await query(
      `
      SELECT 
        idusuario,
        username,
        nombrecompleto,
        rol,
        email,
        activo
      FROM usuarios
      WHERE idusuario = $1
      LIMIT 1
      `,
      [idusuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    const user = result.rows[0];

    if (!user.activo) {
      return res.status(401).json({
        success: false,
        message: "Usuario inactivo",
      });
    }

    const empresas = await obtenerEmpresasUsuario(user.idusuario);

    if (empresas.length === 0) {
      return res.status(403).json({
        success: false,
        message: "El usuario no tiene empresas asociadas",
      });
    }

    const empresaPredeterminada =
      empresas.find((empresa) => empresa.es_predeterminada) || empresas[0];

    return res.json({
      success: true,
      user: {
        id: user.idusuario,
        idusuario: user.idusuario,
        username: user.username,
        nombre: user.nombrecompleto,
        rol: user.rol,
        email: user.email,
      },
      empresas,
      empresa_actual: empresaPredeterminada,
    });
  } catch (error) {
    console.error("❌ Error en /api/auth/me:", error);

    return res.status(500).json({
      success: false,
      message: "Error validando sesión",
    });
  }
});

export default router;