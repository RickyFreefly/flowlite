from flask import Blueprint, render_template, session, redirect, url_for
from utils.auth_required import login_required_backend
import requests
import config

dashboard_bp = Blueprint("dashboard", __name__)


# ========================================
# 🔹 Helpers
# ========================================
def get_headers():
    headers = {
        "Authorization": f"Bearer {session.get('token')}",
    }

    if session.get("idempresa"):
        headers["x-empresa-id"] = session["idempresa"]

    return headers


def construir_static_url(path):
    """
    Convierte una ruta guardada en BD en una URL usable por Flask.

    Ejemplo en BD:
    uploads/empresas/d53.../logo_color.png

    Resultado:
    /static/uploads/empresas/d53.../logo_color.png

    También soporta:
    - https://dominio.com/logo.png
    - /static/uploads/...
    """
    if not path:
        return None

    path = str(path).strip()

    if not path:
        return None

    if path.startswith("http://") or path.startswith("https://"):
        return path

    if path.startswith("/static/"):
        return path

    path = path.lstrip("/")

    return url_for("static", filename=path)


def obtener_empresa_activa():
    """
    Consulta la empresa activa desde el backend Node.
    Requiere que exista el endpoint:
    GET /api/empresas/actual
    """
    if not session.get("token") or not session.get("idempresa"):
        return None

    try:
        response = requests.get(
            f"{config.API_URL}/empresas/actual",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            return data.get("empresa")

        print(
            f"⚠️ No se pudo consultar empresa activa. "
            f"Status: {response.status_code} - {response.text}"
        )

    except requests.exceptions.Timeout:
        print("⚠️ Timeout consultando empresa activa desde dashboard.")

    except requests.exceptions.ConnectionError:
        print("⚠️ No fue posible conectar con backend consultando empresa activa.")

    except Exception as e:
        print(f"⚠️ Error consultando empresa activa: {e}")

    return None


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
    username = session.get("username")
    idusuario = session.get("idusuario")
    rol = session.get("rol")

    empresa_nombre = session.get("empresa_nombre")
    empresa_logo_url = None

    print(f"Usuario autenticado: {username} (ID: {idusuario})")

    empresa = obtener_empresa_activa()

    if empresa:
        empresa_nombre = empresa.get("nombre") or empresa_nombre

        # Prioridad para el TOP BAR:
        # 1. logo_url: logo general de la empresa
        # 2. logo_ticket_url: fallback si no existe logo general
        logo_url = empresa.get("logo_url")
        logo_ticket_url = empresa.get("logo_ticket_url")

        empresa_logo_url = construir_static_url(logo_url or logo_ticket_url)

        # Mantener nombre actualizado en sesión
        if empresa_nombre:
            session["empresa_nombre"] = empresa_nombre

    return render_template(
        "dashboard.html",
        username=username,
        idusuario=idusuario,
        rol=rol,
        empresa_nombre=empresa_nombre,
        empresa_logo_url=empresa_logo_url
    )