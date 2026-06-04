// routes/paracaidistasHoras.js
import express from "express";
import { query } from "../db.js";
import nodemailer from "nodemailer";

const router = express.Router();

/* =========================
   AUTH / ROLES
========================= */
function requireAuth(req, res, next) {
  if (!req.user?.idusuario) return res.status(401).json({ error: "No autorizado" });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const rol = String(req.user?.rol || "").toUpperCase();
    const allowed = roles.map((r) => String(r).toUpperCase());
    if (!allowed.includes(rol)) return res.status(403).json({ error: "No autorizado" });
    next();
  };
}

/* =========================
   MAILER
========================= */
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

/* =========================
   HELPERS
========================= */
async function getCoachByUserId(idusuario) {
  const r = await query(
    `SELECT idcoach, nombre, email, idusuario
     FROM public.coach
     WHERE idusuario = $1 AND activo = true`,
    [Number(idusuario)]
  );
  return r.rows[0] || null;
}

async function getCoachById(idcoach) {
  const r = await query(
    `SELECT idcoach, nombre, email
     FROM public.coach
     WHERE idcoach = $1 AND activo = true`,
    [Number(idcoach)]
  );
  return r.rows[0] || null;
}

async function getParacaidistaById(idparacaidista) {
  const r = await query(
    `SELECT idparacaidista, identificacion, nombre, email, minutos_comprados
     FROM public.paracaidistas_horas
     WHERE idparacaidista = $1`,
    [Number(idparacaidista)]
  );
  return r.rows[0] || null;
}

async function getTotalesParacaidista(idparacaidista) {
  const rPar = await query(
    `SELECT minutos_comprados
     FROM public.paracaidistas_horas
     WHERE idparacaidista = $1`,
    [Number(idparacaidista)]
  );
  if (rPar.rows.length === 0) return null;

  const comprados = Number(rPar.rows[0].minutos_comprados || 0);

  const rSum = await query(
    `SELECT COALESCE(SUM(minutos_ejecutados),0) AS ejecutado
     FROM public.paracaidistas_horas_logs
     WHERE idparacaidista = $1`,
    [Number(idparacaidista)]
  );

  const ejecutado = Number(rSum.rows[0].ejecutado || 0);
  const saldo = comprados - ejecutado;

  return { comprados, ejecutado, saldo };
}

/* ======================================================
   1) Crear paracaidista (ADMIN)
====================================================== */
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { identificacion, nombre, email, minutos_comprados } = req.body;

    if (!identificacion || !nombre || !email) {
      return res.status(400).json({ error: "identificacion, nombre y email son obligatorios" });
    }

    const mins = Number(minutos_comprados || 0);

    const r = await query(
      `INSERT INTO public.paracaidistas_horas (identificacion, nombre, email, minutos_comprados)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [identificacion.trim(), nombre.trim(), email.trim(), mins]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("❌ Error creando paracaidista:", e);
    if (String(e.message || "").includes("duplicate key")) {
      return res.status(409).json({ error: "Ya existe un paracaidista con esa identificación" });
    }
    res.status(500).json({ error: "Error creando paracaidista" });
  }
});

/* ======================================================
   2) Buscar paracaidista por identificación (ADMIN/COACH)
====================================================== */
router.get("/by-identificacion/:identificacion", requireAuth, async (req, res) => {
  try {
    const { identificacion } = req.params;

    const r = await query(`SELECT * FROM public.paracaidistas_horas WHERE identificacion = $1`, [
      identificacion.trim(),
    ]);

    if (!r.rows.length) return res.status(404).json({ error: "No encontrado" });

    const par = r.rows[0];
    const totales = await getTotalesParacaidista(par.idparacaidista);

    res.json({ ...par, totales });
  } catch (e) {
    console.error("❌ Error buscando paracaidista:", e);
    res.status(500).json({ error: "Error buscando paracaidista" });
  }
});

/* ======================================================
   3) Crear log (ADMIN/COACH) + email
====================================================== */
router.post("/:idparacaidista/logs", requireAuth, async (req, res) => {
  try {
    const { idparacaidista } = req.params;
    const { minutos_ejecutados, fecha_ejecucion, observacion } = req.body;

    const rol = String(req.user?.rol || "").toUpperCase();
    const idusuario = Number(req.user.idusuario);

    const mins = Number(minutos_ejecutados || 0);
    if (!mins || mins <= 0) return res.status(400).json({ error: "minutos_ejecutados debe ser > 0" });

    const tot = await getTotalesParacaidista(Number(idparacaidista));
    if (!tot) return res.status(404).json({ error: "Paracaidista no encontrado" });

    if (mins > tot.saldo) {
      return res.status(400).json({ error: `Saldo insuficiente. Saldo actual: ${tot.saldo}` });
    }

    // Resolver coach según rol
    let idcoach = req.body?.idcoach ? Number(req.body.idcoach) : null;
    let coachNombre = null;

    if (rol === "COACH") {
      const coach = await getCoachByUserId(idusuario);
      if (!coach) return res.status(400).json({ error: "Coach no vinculado a usuario" });
      idcoach = Number(coach.idcoach);
      coachNombre = coach.nombre;
    } else {
      // ADMIN: si envía idcoach, validamos que exista
      if (idcoach) {
        const c = await getCoachById(idcoach);
        if (!c) return res.status(400).json({ error: "idcoach inválido o coach inactivo" });
        coachNombre = c.nombre;
      }
    }

    const totalAntes = tot.ejecutado;
    const totalDespues = totalAntes + mins;
    const saldoDespues = tot.comprados - totalDespues;

    const rLog = await query(
      `INSERT INTO public.paracaidistas_horas_logs
       (idparacaidista, fecha_ejecucion, minutos_ejecutados,
        total_ejecutado_antes, total_ejecutado_despues, saldo_despues,
        observacion, idcoach)
       VALUES ($1, COALESCE($2::timestamp, NOW()), $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        Number(idparacaidista),
        fecha_ejecucion || null,
        mins,
        totalAntes,
        totalDespues,
        saldoDespues,
        observacion || null,
        idcoach,
      ]
    );

    const log = rLog.rows[0];

    const par = await getParacaidistaById(Number(idparacaidista));
    if (!par) return res.status(404).json({ error: "Paracaidista no encontrado" });

    const subject = `Registro de vuelo - ${par.nombre} (${par.identificacion})`;
    const body = `
Hola ${par.nombre},

Se registró una sesión de vuelo:

- Minutos ejecutados: ${mins}
- Total ejecutado: ${totalDespues}
- Total comprado: ${tot.comprados}
- Saldo disponible: ${saldoDespues}
- Fecha: ${new Date(log.fecha_ejecucion).toLocaleString()}
- Coach: ${coachNombre || "N/A"}

Observación: ${observacion || "N/A"}

Flow
`.trim();

    const rEmail = await query(
      `INSERT INTO public.paracaidistas_horas_emails (idlog, to_email, subject, body, status, intentos)
       VALUES ($1,$2,$3,$4,'PENDIENTE',0)
       RETURNING *`,
      [log.idlog, par.email, subject, body]
    );

    const emailRow = rEmail.rows[0];

    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: par.email,
        subject,
        text: body,
      });

      await query(
        `UPDATE public.paracaidistas_horas_emails
         SET status='ENVIADO', intentos=intentos+1, sent_at=NOW(), updatedat=NOW()
         WHERE idemail=$1`,
        [emailRow.idemail]
      );

      await query(
        `UPDATE public.paracaidistas_horas_logs
         SET notificado_email=true, fecha_notificacion=NOW()
         WHERE idlog=$1`,
        [log.idlog]
      );
    } catch (mailErr) {
      const errMsg = String(mailErr?.message || mailErr);

      await query(
        `UPDATE public.paracaidistas_horas_emails
         SET status='ERROR', intentos=intentos+1, last_error=$2, updatedat=NOW()
         WHERE idemail=$1`,
        [emailRow.idemail, errMsg]
      );

      await query(
        `UPDATE public.paracaidistas_horas_logs
         SET email_ultimo_error=$2
         WHERE idlog=$1`,
        [log.idlog, errMsg]
      );
    }

    res.status(201).json({ log, email: { idemail: emailRow.idemail } });
  } catch (e) {
    console.error("❌ Error creando log:", e);
    res.status(500).json({ error: "Error creando log" });
  }
});

/* ======================================================
   4) Listar logs (ADMIN ve todo / COACH ve los suyos)
====================================================== */
router.get("/:idparacaidista/logs", requireAuth, async (req, res) => {
  try {
    const { idparacaidista } = req.params;
    const rol = String(req.user?.rol || "").toUpperCase();

    const params = [Number(idparacaidista)];
    let extra = "";

    if (rol === "COACH") {
      const coach = await getCoachByUserId(req.user.idusuario);
      if (!coach) return res.status(400).json({ error: "Coach no vinculado a usuario" });
      extra = " AND l.idcoach = $2";
      params.push(Number(coach.idcoach));
    }

    const r = await query(
      `SELECT l.*,
              c.nombre AS coach_nombre
       FROM public.paracaidistas_horas_logs l
       LEFT JOIN public.coach c ON c.idcoach = l.idcoach
       WHERE l.idparacaidista = $1 ${extra}
       ORDER BY l.fecha_ejecucion DESC`,
      params
    );

    res.json(r.rows);
  } catch (e) {
    console.error("❌ Error listando logs:", e);
    res.status(500).json({ error: "Error listando logs" });
  }
});

/* ======================================================
   2B) Adicionar minutos (ADMIN)
====================================================== */
router.post("/:idparacaidista/adicionar-minutos", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { idparacaidista } = req.params;
    const { minutos_adicionales } = req.body;

    const mins = Number(minutos_adicionales || 0);
    if (!mins || mins <= 0) return res.status(400).json({ error: "minutos_adicionales debe ser > 0" });

    const r = await query(
      `UPDATE public.paracaidistas_horas
       SET minutos_comprados = COALESCE(minutos_comprados,0) + $1
       WHERE idparacaidista = $2
       RETURNING *`,
      [mins, Number(idparacaidista)]
    );

    if (!r.rows.length) return res.status(404).json({ error: "Paracaidista no encontrado" });

    const totales = await getTotalesParacaidista(Number(idparacaidista));
    res.json({ paracaidista: r.rows[0], totales });
  } catch (e) {
    console.error("❌ Error adicionando minutos:", e);
    res.status(500).json({ error: "Error adicionando minutos" });
  }
});

/* ======================================================
   5) Reenviar email (ADMIN libre / COACH solo su log)
====================================================== */
router.post("/logs/:idlog/reenviar-email", requireAuth, async (req, res) => {
  try {
    const { idlog } = req.params;
    const rol = String(req.user?.rol || "").toUpperCase();

    if (rol === "COACH") {
      const coach = await getCoachByUserId(req.user.idusuario);
      if (!coach) return res.status(400).json({ error: "Coach no vinculado a usuario" });

      const rLog = await query(`SELECT idcoach FROM public.paracaidistas_horas_logs WHERE idlog=$1`, [
        Number(idlog),
      ]);
      if (!rLog.rows.length) return res.status(404).json({ error: "Log no encontrado" });

      if (Number(rLog.rows[0].idcoach || 0) !== Number(coach.idcoach)) {
        return res.status(403).json({ error: "No autorizado" });
      }
    }

    const rEmail = await query(
      `SELECT *
       FROM public.paracaidistas_horas_emails
       WHERE idlog = $1
       ORDER BY createdat DESC
       LIMIT 1`,
      [Number(idlog)]
    );
    if (!rEmail.rows.length) return res.status(404).json({ error: "No hay email asociado a este log" });

    const email = rEmail.rows[0];

    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email.to_email,
      subject: email.subject,
      text: email.body,
    });

    await query(
      `UPDATE public.paracaidistas_horas_emails
       SET status='ENVIADO', intentos=intentos+1, sent_at=NOW(), updatedat=NOW(), last_error=NULL
       WHERE idemail=$1`,
      [email.idemail]
    );

    await query(
      `UPDATE public.paracaidistas_horas_logs
       SET notificado_email=true, fecha_notificacion=NOW(), email_ultimo_error=NULL
       WHERE idlog=$1`,
      [Number(idlog)]
    );

    res.json({ message: "Email reenviado" });
  } catch (e) {
    console.error("❌ Error reenviando email:", e);
    res.status(500).json({ error: "Error reenviando email" });
  }
});

/* ======================================================
   6) ENTRENAMIENTOS COACH (según tus tablas)
====================================================== */

// ADMIN: asignar minutos mensuales (upsert)
router.post("/coach/:idcoach/asignar", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const idcoach = Number(req.params.idcoach);
    const anio = Number(req.body.anio);
    const mes = Number(req.body.mes);
    const minutos_asignados = Number(req.body.minutos_asignados || 0);

    if (!idcoach || !anio || !mes) return res.status(400).json({ error: "idcoach, anio, mes son obligatorios" });

    const r = await query(
      `INSERT INTO public.coach_horas_asignacion (idcoach, anio, mes, minutos_asignados, createdby)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (idcoach, anio, mes)
       DO UPDATE SET minutos_asignados = EXCLUDED.minutos_asignados
       RETURNING *`,
      [idcoach, anio, mes, minutos_asignados, Number(req.user.idusuario)]
    );

    res.json(r.rows[0]);
  } catch (e) {
    console.error("❌ Error asignando horas:", e);
    res.status(500).json({ error: "Error asignando horas" });
  }
});

// COACH: registrar ejecución de entrenamientos
router.post("/coach/entrenamientos", requireAuth, requireRole("COACH"), async (req, res) => {
  try {
    const coach = await getCoachByUserId(req.user.idusuario);
    if (!coach) return res.status(400).json({ error: "Coach no vinculado a usuario" });

    const minutos = Number(req.body.minutos_ejecutados || 0);
    const fecha = req.body.fecha_ejecucion || null;
    const observacion = req.body.observacion || null;

    if (!minutos || minutos <= 0) return res.status(400).json({ error: "minutos_ejecutados debe ser > 0" });

    const r = await query(
      `INSERT INTO public.coach_horas_ejecucion
       (idcoach, fecha_ejecucion, minutos_ejecutados, observacion, createdby)
       VALUES ($1, COALESCE($2::timestamp, NOW()), $3, $4, $5)
       RETURNING *`,
      [Number(coach.idcoach), fecha, minutos, observacion, Number(req.user.idusuario)]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("❌ Error registrando entrenamiento:", e);
    res.status(500).json({ error: "Error registrando entrenamiento" });
  }
});

// COACH: resumen mensual
router.get("/coach/entrenamientos/resumen", requireAuth, requireRole("COACH"), async (req, res) => {
  try {
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    if (!anio || !mes) return res.status(400).json({ error: "anio y mes son obligatorios" });

    const coach = await getCoachByUserId(req.user.idusuario);
    if (!coach) return res.status(400).json({ error: "Coach no vinculado a usuario" });

    const a = await query(
      `SELECT COALESCE(minutos_asignados,0) AS asignados
       FROM public.coach_horas_asignacion
       WHERE idcoach=$1 AND anio=$2 AND mes=$3`,
      [Number(coach.idcoach), anio, mes]
    );

    const e = await query(
      `SELECT COALESCE(SUM(minutos_ejecutados),0) AS ejecutados
       FROM public.coach_horas_ejecucion
       WHERE idcoach=$1
         AND EXTRACT(YEAR FROM fecha_ejecucion)=$2
         AND EXTRACT(MONTH FROM fecha_ejecucion)=$3`,
      [Number(coach.idcoach), anio, mes]
    );

    const asignados = Number(a.rows[0]?.asignados || 0);
    const ejecutados = Number(e.rows[0]?.ejecutados || 0);

    res.json({ anio, mes, asignados, ejecutados, saldo: asignados - ejecutados });
  } catch (e) {
    console.error("❌ Error consultando resumen:", e);
    res.status(500).json({ error: "Error consultando resumen" });
  }
});

export default router;
