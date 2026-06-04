// static/js/paracaidistas_horas.js
document.addEventListener("DOMContentLoaded", () => {
  // ========= Elementos Logs =========
  const btn = document.getElementById("btnCargarLogs");
  const table = document.getElementById("logsTable");
  const tbody = table?.querySelector("tbody");

  // ========= Elementos Coach (form registrar consumo) =========
  // HTML (solo ADMIN): <select id="selectCoach" name="idcoach" required>...</select>
  const coachSelect = document.getElementById("selectCoach");

  // ========= Form de registrar consumo =========
  // Para validar antes de enviar (solo si existe)
  const formLog = document.querySelector('form[action*="/logs/crear"]');

  // Si no estamos en la pantalla de paracaidistas, salimos sin romper
  if (!btn || !table || !tbody) return;

  // =========================================================
  // Helpers
  // =========================================================
  function badgeEmail(notificado, ultimoError) {
    if (notificado) return `<span class="badge badge-ok">ENVIADO</span>`;
    if (ultimoError) return `<span class="badge badge-err">ERROR</span>`;
    return `<span class="badge badge-pend">PENDIENTE</span>`;
  }

  function fmtDate(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString();
    } catch {
      return v;
    }
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isAdminScreen() {
    // Si existe el select, asumimos que es ADMIN (así quedó tu template)
    return !!coachSelect;
  }

  // =========================================================
  // 1) Cargar coaches y llenar el select (solo si existe)
  // Endpoint Flask: GET /paracaidistas-horas/coach
  // =========================================================
  async function cargarCoaches() {
    if (!coachSelect) return; // COACH no tiene select

    coachSelect.innerHTML = `<option value="">Cargando coaches...</option>`;
    coachSelect.disabled = true;

    try {
      const resp = await fetch("/paracaidistas-horas/coach", { cache: "no-store" });
      if (!resp.ok) {
        coachSelect.innerHTML = `<option value="">❌ Error cargando coaches</option>`;
        coachSelect.disabled = false;
        return;
      }

      const coaches = await resp.json();

      if (!Array.isArray(coaches) || coaches.length === 0) {
        coachSelect.innerHTML = `<option value="">⚠️ No hay coaches</option>`;
        coachSelect.disabled = false;
        return;
      }

      // Opción por defecto
      coachSelect.innerHTML = `<option value="">Seleccione coach...</option>`;

      // Poblar
      coaches.forEach((c) => {
        const id = c.idcoach ?? c.id ?? "";
        const nombre = c.nombre ?? c.name ?? "";
        if (!id || !nombre) return;

        const opt = document.createElement("option");
        opt.value = String(id);
        opt.textContent = nombre;
        coachSelect.appendChild(opt);
      });

      coachSelect.disabled = false;

      // Debug útil
      console.log("✅ Coaches cargados:", coaches.length);
    } catch (e) {
      console.error("❌ Error cargando coaches:", e);
      coachSelect.innerHTML = `<option value="">❌ Error cargando coaches</option>`;
      coachSelect.disabled = false;
    }
  }

  // =========================================================
  // 2) Cargar logs (incluye Coach)
  // NOTA: Tu HTML tiene 8 columnas
  // =========================================================
  async function cargarLogs() {
    const idparacaidista = btn.dataset.idparacaidista;
    const COLS = 8;

    if (!idparacaidista) {
      tbody.innerHTML = `<tr><td colspan="${COLS}" class="empty">❌ Falta idparacaidista</td></tr>`;
      return;
    }

    tbody.innerHTML = `<tr><td colspan="${COLS}" class="empty">Cargando...</td></tr>`;

    try {
      const resp = await fetch(`/paracaidistas-horas/${idparacaidista}/logs`, { cache: "no-store" });
      if (!resp.ok) {
        tbody.innerHTML = `<tr><td colspan="${COLS}" class="empty">❌ Error consultando logs</td></tr>`;
        return;
      }

      const logs = await resp.json();
      if (!Array.isArray(logs) || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${COLS}" class="empty">⚠️ No hay logs</td></tr>`;
        return;
      }

      // Debug útil: mira qué campos vienen realmente
      console.log("📦 Logs recibido (primer item):", logs[0]);

      tbody.innerHTML = logs
        .map((l) => {
          const emailStatus = badgeEmail(l.notificado_email, l.email_ultimo_error);
          const puedeReenviar = !l.notificado_email;

          const btnReenviar = puedeReenviar
            ? `<button class="btn-mini btn-mini-warn" data-idlog="${l.idlog}">Reenviar</button>`
            : `<span class="muted">-</span>`;

          // Coach: soporta varios nombres de campo por si cambiaste el backend
          const coachNombre = escapeHtml(
            l.coach_nombre ??
            l.coachNombre ??
            l.nombre_coach ??
            l.coach ??
            "-"
          );

          return `
            <tr>
              <td>${fmtDate(l.fecha_ejecucion)}</td>
              <td>${Number(l.minutos_ejecutados || 0)}</td>
              <td>${Number(l.total_ejecutado_antes || 0)}</td>
              <td>${Number(l.total_ejecutado_despues || 0)}</td>
              <td>${Number(l.saldo_despues || 0)}</td>
              <td>${coachNombre}</td>
              <td>${emailStatus}</td>
              <td>${btnReenviar}</td>
            </tr>
          `;
        })
        .join("");
    } catch (e) {
      console.error("❌ Error consultando logs:", e);
      tbody.innerHTML = `<tr><td colspan="8" class="empty">❌ Error consultando logs</td></tr>`;
    }
  }

  // =========================================================
  // 3) Reenviar email
  // =========================================================
  async function reenviarEmail(idlog) {
    try {
      const resp = await fetch(`/paracaidistas-horas/logs/${idlog}/reenviar-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        alert(`❌ No se pudo reenviar: ${data.error || "Error"}`);
        return;
      }

      alert("✅ Email reenviado");
      cargarLogs();
    } catch (e) {
      console.error("❌ Error reenviando email:", e);
      alert("❌ Error reenviando email");
    }
  }

  // =========================================================
  // 4) Validación front (ADMIN): no dejar enviar si no hay coach
  // =========================================================
  function bindValidacionCoach() {
    if (!formLog) return;

    formLog.addEventListener("submit", (e) => {
      if (!isAdminScreen()) return; // si no es ADMIN, no valida

      // Si es ADMIN, debe existir el select y debe tener valor
      if (!coachSelect) {
        e.preventDefault();
        alert("❌ No se encontró el selector de coach. Revisa el template/rol.");
        return;
      }

      if (!coachSelect.value) {
        e.preventDefault();
        alert("⚠️ Debes seleccionar un coach antes de guardar el log.");
        coachSelect.focus();
      }
    });
  }

  // =========================================================
  // Eventos
  // =========================================================
  btn.addEventListener("click", cargarLogs);

  tbody.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.matches("button[data-idlog]")) {
      reenviarEmail(t.dataset.idlog);
    }
  });

  // Inicial
  cargarCoaches();
  bindValidacionCoach();
});
 