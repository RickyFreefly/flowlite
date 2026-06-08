# routes/cierre.py
from flask import Blueprint, render_template, session, redirect, url_for, flash
import requests
import config

cierre_bp = Blueprint("cierre", __name__)


# =========================
# 🔹 Helper de headers
# =========================
def get_headers():
    headers = {
        "Authorization": f"Bearer {session.get('token')}",
    }

    if session.get("idempresa"):
        headers["x-empresa-id"] = session["idempresa"]

    return headers


# =========================
# 📘 CIERRE DIARIO - VISTA
# =========================
@cierre_bp.route("/cierre-dia")
def cierre_dia():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    if not session.get("idempresa"):
        flash("No se encontró empresa asociada a la sesión.", "danger")
        return redirect(url_for("dashboard.index"))

    try:
        headers = get_headers()

        response = requests.get(
            f"{config.API_URL}/cierre-dia",
            headers=headers,
            timeout=15
        )

        if response.status_code == 200:
            data = response.json()

            detalle = data.get("detalle", [])
            totales = data.get("totales", [])
            fecha_cierre = data.get("fecha_cierre", "")

            return render_template(
                "cierre.html",
                detalle=detalle,
                totales=totales,
                fecha_cierre=fecha_cierre
            )

        else:
            try:
                error_data = response.json()
                mensaje_error = error_data.get(
                    "error",
                    "Error al obtener el informe de cierre diario"
                )
                detalle_error = error_data.get("detalle", "")
            except Exception:
                mensaje_error = "Error al obtener el informe de cierre diario"
                detalle_error = response.text

            print("❌ Error backend cierre-dia:", response.status_code, detalle_error)

            flash(f"❌ {mensaje_error}", "danger")
            return redirect(url_for("dashboard.index"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")
        return redirect(url_for("dashboard.index"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("dashboard.index"))

    except Exception as e:
        print("❌ Error conectando con el backend:", e)
        flash(f"Error conectando con el backend: {e}", "danger")
        return redirect(url_for("dashboard.index"))