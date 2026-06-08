# routes/cierre_informe.py
from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config

informe_bp = Blueprint("informe", __name__, url_prefix="/informe")


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


# ===============================
# 📘 INFORME DE CIERRE POR FECHA O RANGO
# ===============================
@informe_bp.route("/", methods=["GET", "POST"])
def cierre_informe():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    if not session.get("idempresa"):
        flash("No se encontró empresa asociada a la sesión.", "danger")
        return redirect(url_for("dashboard.index"))

    data = None
    error = None

    if request.method == "POST":
        fecha = request.form.get("fecha", "").strip()
        inicio = request.form.get("inicio", "").strip()
        fin = request.form.get("fin", "").strip()

        try:
            headers = get_headers()
            url = f"{config.API_URL}/cierre-dia"

            # 🔹 Construir parámetros de búsqueda
            params = {}

            if fecha:
                params["fecha"] = fecha
            elif inicio and fin:
                params["inicio"] = inicio
                params["fin"] = fin

            response = requests.get(
                url,
                headers=headers,
                params=params,
                timeout=15
            )

            if response.status_code == 200:
                data = response.json()
            else:
                try:
                    error_data = response.json()
                    error = error_data.get(
                        "error",
                        "Error al obtener el informe desde el servidor."
                    )

                    detalle_error = error_data.get("detalle")
                    if detalle_error:
                        print("❌ Detalle backend cierre informe:", detalle_error)

                except Exception:
                    error = "Error al obtener el informe desde el servidor."
                    print("❌ Respuesta backend:", response.text)

        except requests.exceptions.Timeout:
            error = "El backend tardó demasiado en responder."

        except requests.exceptions.ConnectionError:
            error = "No fue posible conectar con el backend."

        except Exception as e:
            error = f"Error de conexión: {e}"

    return render_template(
        "cierre_informe.html",
        data=data,
        error=error
    )