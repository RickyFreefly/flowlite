from flask import Blueprint, render_template, session, redirect, url_for
from utils.auth_required import login_required_backend

dashboard_bp = Blueprint("dashboard", __name__)


# ========================================
# 🔹 Ruta raíz: redirige según sesión
# ========================================
@dashboard_bp.route("/")
def home():
    if "token" in session:
        return redirect(url_for("dashboard.index"))

    return redirect(url_for("auth.login"))


# ========================================
# 🔹 Dashboard principal
# ========================================
@dashboard_bp.route("/dashboard")
@login_required_backend
def index():
    # 🔹 Si llega hasta aquí, el token ya fue validado
    username = session.get("username")
    idusuario = session.get("idusuario")
    rol = session.get("rol")

    # 🔹 Debug
    print(f"Usuario autenticado: {username} (ID: {idusuario})")

    return render_template(
        "dashboard.html",
        username=username,
        idusuario=idusuario,
        rol=rol
    )