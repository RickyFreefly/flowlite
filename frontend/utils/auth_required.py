from functools import wraps
from flask import session, redirect, url_for, flash
import requests
import config


def login_required_backend(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = session.get("token")

        # 1. Si no hay token en la sesión Flask
        if not token:
            session.clear()
            flash("Debes iniciar sesión.", "warning")
            return redirect(url_for("auth.login"))

        try:
            # 2. Validar token contra backend Node.js
            # config.API_URL ya debe terminar en /api
            # Ejemplo: http://localhost:3000/api
            response = requests.get(
                f"{config.API_URL}/auth/me",
                headers={
                    "Authorization": f"Bearer {token}"
                },
                timeout=5
            )

            # 3. Token vencido, inválido o sin autorización
            if response.status_code in [401, 403]:
                session.clear()
                flash("Tu sesión expiró. Inicia sesión nuevamente.", "danger")
                return redirect(url_for("auth.login"))

            # 4. Cualquier otro error del backend
            if response.status_code != 200:
                session.clear()
                flash("No fue posible validar la sesión.", "danger")
                return redirect(url_for("auth.login"))

            # 5. Validar respuesta JSON del backend
            data = response.json()

            if not data.get("success"):
                session.clear()
                flash("Sesión no válida. Inicia sesión nuevamente.", "danger")
                return redirect(url_for("auth.login"))

        except requests.exceptions.Timeout:
            session.clear()
            flash("Tiempo agotado validando la sesión. Inicia sesión nuevamente.", "danger")
            return redirect(url_for("auth.login"))

        except requests.exceptions.ConnectionError:
            session.clear()
            flash("No fue posible conectar con el servidor. Inicia sesión nuevamente.", "danger")
            return redirect(url_for("auth.login"))

        except Exception:
            session.clear()
            flash("Error validando la sesión. Inicia sesión nuevamente.", "danger")
            return redirect(url_for("auth.login"))

        return f(*args, **kwargs)

    return decorated_function