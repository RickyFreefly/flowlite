# routes/cierre_informe.py
from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config

informe_bp = Blueprint("informe", __name__, url_prefix="/informe")

# ===============================
# 📘 INFORME DE CIERRE POR FECHA O RANGO
# ===============================
@informe_bp.route("/", methods=["GET", "POST"])
def cierre_informe():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    data = None
    error = None

    if request.method == "POST":
        fecha = request.form.get("fecha")
        inicio = request.form.get("inicio")
        fin = request.form.get("fin")

        try:
            headers = {"Authorization": f"Bearer {session['token']}"}
            url = f"{config.API_URL}/cierre-dia"

            # 🔹 Construir los parámetros
            params = {}
            if fecha:
                params["fecha"] = fecha
            elif inicio and fin:
                params["inicio"] = inicio
                params["fin"] = fin

            response = requests.get(url, headers=headers, params=params)
            if response.status_code == 200:
                data = response.json()
            else:
                error = "❌ Error al obtener el informe desde el servidor."
        except Exception as e:
            error = f"Error de conexión: {e}"

    return render_template("cierre_informe.html", data=data, error=error)
