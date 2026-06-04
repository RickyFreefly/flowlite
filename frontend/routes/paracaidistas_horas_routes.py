from flask import Blueprint, render_template, request, redirect, url_for, flash, session, jsonify
import requests
import config
from datetime import datetime

paracaidistas_horas_bp = Blueprint(
    "paracaidistas_horas",
    __name__,
    url_prefix="/paracaidistas-horas"
)

# =========================================================
# Helpers
# =========================================================
def _headers_json():
    return {
        "Authorization": f"Bearer {session['token']}",
        "Content-Type": "application/json",
    }

def _headers_auth():
    return {"Authorization": f"Bearer {session['token']}"}

def _rol():
    return (session.get("rol") or "USER").upper()

def _require_login():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return False
    return True

def _require_admin():
    if _rol() != "ADMIN":
        flash("No autorizado (solo ADMIN)", "danger")
        return False
    return True


# =========================================================
# 1) LISTADO / BÚSQUEDA POR IDENTIFICACIÓN
# =========================================================
@paracaidistas_horas_bp.route("/", methods=["GET"])
def listado():
    if not _require_login():
        return redirect(url_for("auth.login"))

    identificacion = (request.args.get("identificacion") or "").strip()
    paracaidista = None
    error = None

    try:
        if identificacion:
            r = requests.get(
                f"{config.API_URL}/paracaidistas-horas/by-identificacion/{identificacion}",
                headers=_headers_auth(),
            )

            if r.status_code == 200:
                paracaidista = r.json()
            elif r.status_code == 404:
                flash("⚠️ No encontrado", "warning")
            else:
                error = r.text
                flash("❌ Error consultando el backend", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return render_template(
        "paracaidistas_horas.html",
        identificacion=identificacion,
        paracaidista=paracaidista,
        error=error,
        datetime=datetime,
        rol=_rol(),  # ✅ IMPORTANTÍSIMO: para mostrar/ocultar secciones en el HTML
    )


# =========================================================
# 2) CREAR PARACAIDISTA (solo ADMIN)
# =========================================================
@paracaidistas_horas_bp.route("/crear", methods=["POST"])
def crear_paracaidista():
    if not _require_login():
        return redirect(url_for("auth.login"))
    if not _require_admin():
        return redirect(url_for("paracaidistas_horas.listado"))

    identificacion = (request.form.get("identificacion") or "").strip()
    nombre = (request.form.get("nombre") or "").strip()
    email = (request.form.get("email") or "").strip()
    minutos_comprados = request.form.get("minutos_comprados") or "0"

    data = {
        "identificacion": identificacion,
        "nombre": nombre,
        "email": email,
        "minutos_comprados": float(minutos_comprados or 0),
    }

    try:
        r = requests.post(
            f"{config.API_URL}/paracaidistas-horas",
            headers=_headers_json(),
            json=data,
        )

        if r.status_code == 201:
            flash("✅ Paracaidista creado", "success")
            return redirect(url_for("paracaidistas_horas.listado", identificacion=identificacion))

        try:
            msg = r.json().get("error", r.text)
        except Exception:
            msg = r.text
        flash(f"❌ No se pudo crear: {msg}", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("paracaidistas_horas.listado"))


# =========================================================
# 2B) ADICIONAR MINUTOS (solo ADMIN)
# =========================================================
@paracaidistas_horas_bp.route("/<int:idparacaidista>/adicionar-minutos", methods=["POST"])
def adicionar_minutos(idparacaidista):
    if not _require_login():
        return redirect(url_for("auth.login"))
    if not _require_admin():
        return redirect(url_for("paracaidistas_horas.listado"))

    identificacion = (request.form.get("identificacion") or "").strip()
    minutos_adicionales = request.form.get("minutos_adicionales") or "0"

    payload = {"minutos_adicionales": float(minutos_adicionales or 0)}

    try:
        r = requests.post(
            f"{config.API_URL}/paracaidistas-horas/{idparacaidista}/adicionar-minutos",
            headers=_headers_json(),
            json=payload,
        )

        if r.status_code == 200:
            flash("✅ Minutos adicionados correctamente", "success")
        else:
            try:
                msg = r.json().get("error", r.text)
            except Exception:
                msg = r.text
            flash(f"❌ Error adicionando minutos: {msg}", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    if identificacion:
        return redirect(url_for("paracaidistas_horas.listado", identificacion=identificacion))
    return redirect(url_for("paracaidistas_horas.listado"))


# =========================================================
# 3) CREAR LOG DE CONSUMO
# REGLAS:
# - ADMIN: debe enviar idcoach (del select)
# - COACH: NO envía idcoach (Node lo infiere por su usuario)
# =========================================================
@paracaidistas_horas_bp.route("/<int:idparacaidista>/logs/crear", methods=["POST"])
def crear_log(idparacaidista):
    if not _require_login():
        return redirect(url_for("auth.login"))

    rol = _rol()

    minutos_ejecutados = request.form.get("minutos_ejecutados") or "0"
    fecha_ejecucion = request.form.get("fecha_ejecucion")
    observacion = request.form.get("observacion") or ""
    identificacion = (request.form.get("identificacion") or "").strip()

    payload = {
        "minutos_ejecutados": float(minutos_ejecutados or 0),
        "fecha_ejecucion": fecha_ejecucion or None,
        "observacion": observacion,
    }

    # ✅ ADMIN: exige coach
    if rol == "ADMIN":
        idcoach = (request.form.get("idcoach") or "").strip()
        if not idcoach:
            flash("❌ Debes seleccionar un coach", "danger")
            return redirect(url_for("paracaidistas_horas.listado", identificacion=identificacion))
        payload["idcoach"] = int(idcoach)

    # ✅ COACH: NO manda idcoach

    try:
        r = requests.post(
            f"{config.API_URL}/paracaidistas-horas/{idparacaidista}/logs",
            headers=_headers_json(),
            json=payload,
        )

        if r.status_code == 201:
            flash("✅ Log registrado. Si el correo falla, quedará listo para reenvío.", "success")
        else:
            try:
                msg = r.json().get("error", r.text)
            except Exception:
                msg = r.text
            flash(f"❌ Error registrando log: {msg}", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    if identificacion:
        return redirect(url_for("paracaidistas_horas.listado", identificacion=identificacion))
    return redirect(url_for("paracaidistas_horas.listado"))


# =========================================================
# 4) OBTENER LOGS (AJAX)
# Node ya filtra si el rol es COACH (según token JWT)
# =========================================================
@paracaidistas_horas_bp.route("/<int:idparacaidista>/logs", methods=["GET"])
def listar_logs_ajax(idparacaidista):
    if "token" not in session:
        return jsonify({"error": "No autorizado"}), 401

    try:
        r = requests.get(
            f"{config.API_URL}/paracaidistas-horas/{idparacaidista}/logs",
            headers=_headers_auth(),
        )

        if r.status_code == 200:
            return jsonify(r.json())

        return jsonify({"error": "Error consultando logs", "raw": r.text}), r.status_code

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =========================================================
# 5) REENVIAR EMAIL (por idlog)
# Node valida si COACH intenta reenviar uno que no es suyo
# =========================================================
@paracaidistas_horas_bp.route("/logs/<int:idlog>/reenviar-email", methods=["POST"])
def reenviar_email(idlog):
    if "token" not in session:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    try:
        r = requests.post(
            f"{config.API_URL}/paracaidistas-horas/logs/{idlog}/reenviar-email",
            headers=_headers_auth(),
        )

        if r.status_code == 200:
            return jsonify({"ok": True, "message": "Email reenviado"})

        try:
            msg = r.json().get("error", r.text)
        except Exception:
            msg = r.text
        return jsonify({"ok": False, "error": msg}), r.status_code

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# =========================================================
# 6) LISTAR COACHES (AJAX / FORM)
# Solo ADMIN necesita este catálogo (para el select)
# =========================================================
@paracaidistas_horas_bp.route("/coach", methods=["GET"])
def listar_coaches():
    if "token" not in session:
        return jsonify({"error": "No autorizado"}), 401

    # ✅ Si no es admin, devolvemos lista vacía (no rompemos el front)
    if _rol() != "ADMIN":
        return jsonify([])

    try:
        r = requests.get(
            f"{config.API_URL}/coach",
            headers=_headers_auth(),
        )

        if r.status_code == 200:
            return jsonify(r.json())

        return jsonify({"error": "Error consultando coaches", "raw": r.text}), r.status_code

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =========================================================
# ✅ ALIAS para que app.py pueda importar "paracaidistas_bp"
# =========================================================
paracaidistas_bp = paracaidistas_horas_bp
