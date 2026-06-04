from flask import Blueprint, render_template, request, redirect, url_for, session, flash
import requests
import config

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    # Si ya tiene sesión local, lo mandamos al dashboard
    if request.method == "GET" and session.get("token"):
        return redirect(url_for("dashboard.index"))

    if request.method == "POST":
        # Normalizar usuario a minúsculas
        username = request.form.get("username", "").strip().lower()
        password = request.form.get("password", "").strip()

        if not username or not password:
            flash("Usuario y contraseña son obligatorios.", "warning")
            return render_template("login.html", username=username)

        try:
            # Limpiar cualquier sesión anterior
            session.clear()

            response = requests.post(
                f"{config.API_URL}/auth/login",
                json={
                    "username": username,
                    "password": password
                },
                timeout=10
            )

            try:
                data = response.json()
            except Exception:
                data = {}

            if response.status_code != 200 or not data.get("success"):
                mensaje = (
                    data.get("message")
                    or data.get("error")
                    or "Credenciales inválidas o error de autenticación."
                )
                flash(mensaje, "danger")
                return render_template("login.html", username=username)

            token = data.get("token")
            user = data.get("user", {})
            empresas = data.get("empresas", [])
            empresa_actual = data.get("empresa_actual")

            if not token:
                flash("El backend no retornó un token válido.", "danger")
                return render_template("login.html", username=username)

            if not empresa_actual:
                flash("El usuario no tiene una empresa asociada.", "danger")
                return render_template("login.html", username=username)

            idempresa = empresa_actual.get("idempresa")

            if not idempresa:
                flash("La empresa asociada no tiene un identificador válido.", "danger")
                return render_template("login.html", username=username)

            # Guardar datos principales en sesión Flask
            session["token"] = token
            session["user"] = user
            session["username"] = user.get("username", username)
            session["idusuario"] = user.get("idusuario") or user.get("id")
            session["rol"] = user.get("rol", "USER")
            session["email"] = user.get("email")

            # Guardar contexto multiempresa
            session["empresas"] = empresas
            session["empresa_actual"] = empresa_actual
            session["idempresa"] = idempresa
            session["empresa_nombre"] = empresa_actual.get("nombre")
            session["rol_empresa"] = empresa_actual.get("rol_empresa")

            flash("Login exitoso.", "success")
            return redirect(url_for("dashboard.index"))

        except requests.exceptions.Timeout:
            flash("El backend tardó demasiado en responder.", "danger")

        except requests.exceptions.ConnectionError:
            flash("No fue posible conectar con el backend.", "danger")

        except Exception as e:
            flash(f"Error inesperado durante el login: {e}", "danger")

    return render_template("login.html", username=request.form.get("username", ""))


@auth_bp.route("/logout")
def logout():
    session.clear()
    flash("Sesión cerrada correctamente.", "info")
    return redirect(url_for("auth.login"))


@auth_bp.route("/probar-sesion")
def probar_sesion():
    """
    Ruta temporal para validar que el login multitenant está funcionando.
    Puedes eliminarla después de probar.
    """
    if "token" not in session:
        flash("Debes iniciar sesión primero.", "warning")
        return redirect(url_for("auth.login"))

    try:
        headers = {
            "Authorization": f"Bearer {session['token']}"
        }

        response = requests.get(
            f"{config.API_URL}/auth/me",
            headers=headers,
            timeout=10
        )

        try:
            backend_data = response.json()
        except Exception:
            backend_data = {
                "raw": response.text
            }

        return {
            "status_code": response.status_code,
            "backend_response": backend_data,
            "session": {
                "username": session.get("username"),
                "idusuario": session.get("idusuario"),
                "rol": session.get("rol"),
                "email": session.get("email"),
                "idempresa": session.get("idempresa"),
                "empresa_nombre": session.get("empresa_nombre"),
                "rol_empresa": session.get("rol_empresa"),
                "empresa_actual": session.get("empresa_actual"),
                "empresas": session.get("empresas"),
            }
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }, 500