# routes/vuelos_informe.py
from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config

vuelos_informe_bp = Blueprint(
    "vuelos_informe",
    __name__,
    url_prefix="/informe/vuelos"
)

# ===============================
# 🪂 INFORME DE PERSONAS QUE VOLARON POR MES
# ===============================
@vuelos_informe_bp.route("/", methods=["GET", "POST"])
def vuelos_informe():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    data = None
    error = None

    if request.method == "POST":
        mes = request.form.get("mes")
        inicio = request.form.get("inicio")
        fin = request.form.get("fin")

        try:
            # ✅ Ruta real del backend:
            # Backend: app.use("/api/vuelos-mes", informeVuelosMesRoutes)
            # config.API_URL: http://localhost:3000/api
            url = f"{config.API_URL}/vuelos-mes"

            params = {}

            if mes:
                params["mes"] = mes
            elif inicio and fin:
                params["inicio"] = inicio
                params["fin"] = fin

            print("===================================", flush=True)
            print("🪂 CONSULTANDO INFORME DE VUELOS", flush=True)
            print("API_URL:", config.API_URL, flush=True)
            print("URL FINAL:", url, flush=True)
            print("PARAMS:", params, flush=True)
            print("===================================", flush=True)

            headers = {
                "Authorization": f"Bearer {session['token']}"
            }

            response = requests.get(
                url,
                headers=headers,
                params=params,
                timeout=20
            )

            print("STATUS CODE BACKEND:", response.status_code, flush=True)
            print("RESPUESTA BACKEND:", response.text[:2000], flush=True)

            if response.status_code == 200:
                data = response.json()

            elif response.status_code == 401:
                session.clear()
                flash("Tu sesión expiró. Inicia sesión nuevamente.", "warning")
                return redirect(url_for("auth.login"))

            elif response.status_code == 404:
                error = f"❌ El backend respondió 404. No encontró esta URL: {url}"

            elif response.status_code == 500:
                error = f"❌ El backend respondió 500. Detalle: {response.text[:500]}"

            else:
                error = (
                    f"❌ El backend respondió código {response.status_code}. "
                    f"Detalle: {response.text[:500]}"
                )

        except requests.exceptions.ConnectionError as e:
            error = (
                f"❌ No fue posible conectar con el backend en {config.API_URL}. "
                f"Detalle: {e}"
            )

        except requests.exceptions.Timeout:
            error = "❌ El backend tardó demasiado en responder."

        except Exception as e:
            error = f"❌ Error inesperado consultando el informe: {e}"

    return render_template(
        "vuelos_informe.html",
        data=data,
        error=error
    )