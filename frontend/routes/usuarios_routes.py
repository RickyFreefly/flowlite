from flask import Blueprint, render_template, session, redirect, url_for, flash
import requests
import config

usuarios_bp = Blueprint("usuarios", __name__)


@usuarios_bp.route("/usuarios")
def listar_usuarios():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    if "idempresa" not in session:
        flash("No hay una empresa seleccionada.", "warning")
        return redirect(url_for("auth.login"))

    try:
        headers = {
            "Authorization": f"Bearer {session['token']}",
            "x-empresa-id": session["idempresa"]
        }

        response = requests.get(
            f"{config.API_URL}/usuarios",
            headers=headers,
            timeout=10
        )

        if response.status_code == 200:
            usuarios = response.json()
            return render_template("usuarios.html", usuarios=usuarios)

        if response.status_code == 401:
            session.clear()
            flash("La sesión expiró. Inicia sesión nuevamente.", "warning")
            return redirect(url_for("auth.login"))

        if response.status_code == 403:
            flash("No tienes acceso a esta empresa.", "danger")
            return redirect(url_for("dashboard.index"))

        try:
            error_data = response.json()
            mensaje = error_data.get("error") or error_data.get("message") or "Error al obtener usuarios"
        except Exception:
            mensaje = "Error al obtener usuarios"

        flash(mensaje, "danger")
        return redirect(url_for("dashboard.index"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")
        return redirect(url_for("dashboard.index"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("dashboard.index"))

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("dashboard.index"))