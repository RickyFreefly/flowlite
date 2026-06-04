# routes/cierre.py
from flask import Blueprint, render_template, session, redirect, url_for, flash
import requests
import config

cierre_bp = Blueprint("cierre", __name__)

# =========================
# 📘 CIERRE DIARIO - VISTA
# =========================
@cierre_bp.route("/cierre-dia")
def cierre_dia():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    try:
        headers = {"Authorization": f"Bearer {session['token']}"}
        response = requests.get(f"{config.API_URL}/cierre-dia", headers=headers)

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
            flash("❌ Error al obtener el informe de cierre diario", "danger")
            return redirect(url_for("dashboard.index"))
    except Exception as e:
        flash(f"Error conectando con el backend: {e}", "danger")
        return redirect(url_for("dashboard.index"))
