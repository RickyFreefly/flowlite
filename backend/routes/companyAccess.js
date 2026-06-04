// routes/companyAccess.js
import { query } from "../db.js";

export async function companyAccess(req, res, next) {
  try {
    const idusuario = req.user?.idusuario || req.user?.id;
    const idempresa = req.headers["x-empresa-id"];

    if (!idusuario) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!idempresa) {
      return res.status(400).json({
        success: false,
        error: "Debe seleccionar una empresa",
      });
    }

    const result = await query(
      `
      SELECT 
        ue.idusuario,
        ue.idempresa,
        ue.rol_empresa,
        ue.es_predeterminada,
        e.nombre AS empresa_nombre,
        e.nit,
        e.razon_social
      FROM usuario_empresa ue
      INNER JOIN empresas e ON e.idempresa = ue.idempresa
      WHERE ue.idusuario = $1
        AND ue.idempresa = $2
        AND ue.activo = TRUE
        AND e.activo = TRUE
      LIMIT 1
      `,
      [idusuario, idempresa]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: "No tiene acceso a esta empresa",
      });
    }

    const acceso = result.rows[0];

    req.idempresa = acceso.idempresa;

    req.empresa = {
      idempresa: acceso.idempresa,
      nombre: acceso.empresa_nombre,
      nit: acceso.nit,
      razon_social: acceso.razon_social,
      rol_empresa: acceso.rol_empresa,
      es_predeterminada: acceso.es_predeterminada,
    };

    return next();
  } catch (error) {
    console.error("❌ Error validando acceso a empresa:", error);

    return res.status(500).json({
      success: false,
      error: "Error validando acceso a empresa",
    });
  }
}