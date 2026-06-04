// routes/authJwt.js
import jwt from "jsonwebtoken";

export function authJwt(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        error: "Token requerido",
      });
    }

    const secret = process.env.JWT_SECRET || "mi_secreto_jwt";
    const payload = jwt.verify(token, secret);

    const idusuario = payload.idusuario || payload.id;

    if (!idusuario) {
      return res.status(401).json({
        success: false,
        error: "Token inválido: usuario no identificado",
      });
    }

    req.user = {
      idusuario: Number(idusuario),
      id: Number(idusuario), // compatibilidad con rutas actuales
      username: payload.username,
      rol: payload.rol || "USER",
    };

    return next();
  } catch (err) {
    console.error("❌ Error validando JWT:", err.message);

    return res.status(401).json({
      success: false,
      error: "Token inválido o expirado",
    });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const rol = String(req.user?.rol || "").toUpperCase();
    const allowed = roles.map((r) => String(r).toUpperCase());

    if (!allowed.includes(rol)) {
      return res.status(403).json({
        success: false,
        error: "No autorizado",
      });
    }

    return next();
  };
}