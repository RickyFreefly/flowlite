import { query } from "../db.js";

export async function requireAuth(req, res, next) {
  try {
    // Asumo que el Frontend Flask envía: Authorization: Bearer <token>
    // y que ese token en tu caso ES el token de sesión/usuario que generas en /auth/login
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: "No autorizado" });

    // Ajusta esta validación a tu modelo real.
    // Opción A (recomendada): token = JWT y lo verificas.
    // Opción B (rápida): token = algo que guardas en BD (tabla sesiones).
    // Como no tengo tu implementación, dejo ejemplo con tabla sesiones:

    const s = await query(
      `SELECT u.idusuario, u.username, u.rol, u.activo
       FROM sesiones ses
       JOIN usuarios u ON u.idusuario = ses.idusuario
       WHERE ses.token = $1 AND ses.activa = true`,
      [token]
    );

    const user = s.rows[0];
    if (!user || user.activo === false) {
      return res.status(401).json({ error: "Sesión inválida" });
    }

    req.user = {
      idusuario: Number(user.idusuario),
      username: user.username,
      rol: (user.rol || "ADMIN").toUpperCase(),
    };

    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error autenticando" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const rol = (req.user?.rol || "").toUpperCase();
    if (!roles.map(r => r.toUpperCase()).includes(rol)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    next();
  };
}
