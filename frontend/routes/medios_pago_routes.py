# routes/medios_pago_routes.py
from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config

medios_pago_bp = Blueprint("medios_pago", __name__)


# ================== HELPERS ==================

def require_login():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return False
    return True


def require_empresa():
    if "idempresa" not in session or not session.get("idempresa"):
        flash("No hay una empresa seleccionada.", "warning")
        return False
    return True


def auth_headers(json=True):
    """
    Headers estándar para backend multitenant.
    Todas las rutas protegidas deben enviar:
    - Authorization
    - x-empresa-id
    """
    headers = {
        "Authorization": f"Bearer {session['token']}",
        "x-empresa-id": str(session["idempresa"]),
    }

    if json:
        headers["Content-Type"] = "application/json"

    return headers


def get_current_role():
    return str(session.get("rol", "")).strip().upper()


def is_current_user_admin():
    return get_current_role() == "ADMIN"


def user_can_manage_medios_pago():
    """
    Permite administrar medios de pago a usuarios ADMIN.
    Si después quieres permitir otro rol, agrégalo aquí.
    """
    return get_current_role() == "ADMIN"


def get_backend_error(response, default_message):
    """
    Extrae un mensaje útil desde el backend Node.
    """
    try:
        data = response.json()
        return (
            data.get("error")
            or data.get("message")
            or data.get("detail")
            or default_message
        )
    except Exception:
        return f"{default_message}. Status: {response.status_code}"


def handle_auth_or_company_error(response):
    """
    Maneja errores comunes del backend:
    401: token inválido o expirado
    403: sin acceso a empresa
    400: empresa no enviada u otra validación
    """
    if response.status_code == 401:
        session.clear()
        flash("La sesión expiró. Inicia sesión nuevamente.", "warning")
        return redirect(url_for("auth.login"))

    if response.status_code == 403:
        flash("No tienes acceso a esta empresa.", "danger")
        return redirect(url_for("dashboard.index"))

    return None


def form_bool(value, default=False):
    """
    Convierte valores de formulario HTML a booleano.
    Sirve para select, checkbox o campos hidden.
    """
    if value is None or value == "":
        return default

    texto = str(value).strip().lower()

    if texto in ["true", "1", "si", "sí", "on", "activo", "activa"]:
        return True

    if texto in ["false", "0", "no", "off", "inactivo", "inactiva"]:
        return False

    return default


def validar_acceso_medios_pago():
    """
    Valida sesión, empresa activa y permisos.
    """
    if not require_login():
        return redirect(url_for("auth.login"))

    if not require_empresa():
        return redirect(url_for("auth.login"))

    if not user_can_manage_medios_pago():
        flash("No tienes permiso para administrar medios de pago.", "danger")
        return redirect(url_for("dashboard.index"))

    return None


# ================== LISTAR MEDIOS DE PAGO ==================

@medios_pago_bp.route("/medios-pago")
def listar_medios_pago():
    validacion = validar_acceso_medios_pago()
    if validacion:
        return validacion

    buscar = request.args.get("buscar", "").strip()
    enuso = request.args.get("enuso", "").strip()
    relacionadocon = request.args.get("relacionadocon", "").strip()
    electronico = request.args.get("electronico", "").strip()
    editar_id = request.args.get("editar", "").strip()

    page = request.args.get("page", 1, type=int)
    limit = request.args.get("limit", 10, type=int)

    if page < 1:
        page = 1

    if limit not in [10, 25, 50, 100]:
        limit = 10

    try:
        params = {
            "todos": "true",
            "paginado": "true",
            "page": page,
            "limit": limit,
        }

        if buscar:
            params["buscar"] = buscar

        if enuso:
            params["enuso"] = enuso

        if relacionadocon:
            params["relacionadocon"] = relacionadocon

        if electronico:
            params["electronico"] = electronico

        response = requests.get(
            f"{config.API_URL}/medios",
            headers=auth_headers(json=False),
            params=params,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code != 200:
            error_msg = get_backend_error(response, "Error al obtener medios de pago")
            flash(f"❌ {error_msg}", "danger")

            medios_pago = []
            pagination = {
                "page": 1,
                "limit": limit,
                "total": 0,
                "total_pages": 1,
            }
            resumen = {
                "total_medios": 0,
                "total_en_uso": 0,
                "total_inactivos": 0,
                "total_electronicos": 0,
                "total_no_electronicos": 0,
            }
        else:
            payload = response.json()

            medios_pago = payload.get("data", [])
            pagination = payload.get("pagination", {})
            resumen = payload.get("resumen", {})

            if not isinstance(medios_pago, list):
                medios_pago = []

        medio_editar = None

        if editar_id:
            response_edit = requests.get(
                f"{config.API_URL}/medios/{editar_id}",
                headers=auth_headers(json=False),
                timeout=15
            )

            redireccion = handle_auth_or_company_error(response_edit)
            if redireccion:
                return redireccion

            if response_edit.status_code == 200:
                medio_editar = response_edit.json()
            else:
                error_msg = get_backend_error(response_edit, "Medio de pago no encontrado")
                flash(f"❌ {error_msg}", "warning")

        return render_template(
            "medios_pago.html",
            medios_pago=medios_pago,
            medio_editar=medio_editar,

            buscar=buscar,
            enuso=enuso,
            relacionadocon=relacionadocon,
            electronico=electronico,

            total_medios=resumen.get("total_medios", 0),
            total_en_uso=resumen.get("total_en_uso", 0),
            total_inactivos=resumen.get("total_inactivos", 0),
            total_electronicos=resumen.get("total_electronicos", 0),
            total_no_electronicos=resumen.get("total_no_electronicos", 0),

            page=pagination.get("page", page),
            limit=pagination.get("limit", limit),
            total=pagination.get("total", 0),
            total_pages=pagination.get("total_pages", 1),

            is_admin=is_current_user_admin(),
            empresa_actual=session.get("empresa_actual"),
            empresa_nombre=session.get("empresa_nombre"),
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")
        return redirect(url_for("dashboard.index"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("dashboard.index"))

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("dashboard.index"))


# ================== CREAR MEDIO DE PAGO ==================

@medios_pago_bp.route("/medios-pago/crear", methods=["POST"])
def crear_medio_pago():
    validacion = validar_acceso_medios_pago()
    if validacion:
        return validacion

    data = {
        "nombre": request.form.get("nombre", "").strip(),
        "relacionadocon": request.form.get("relacionadocon", "").strip(),
        "cuentacontable": request.form.get("cuentacontable", "").strip(),
        "mediopagoelectronico": form_bool(
            request.form.get("mediopagoelectronico"),
            default=False
        ),
        "enuso": form_bool(
            request.form.get("enuso"),
            default=True
        ),
        "idsiigo": request.form.get("idsiigo", "").strip(),
    }

    try:
        response = requests.post(
            f"{config.API_URL}/medios",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code in (200, 201):
            flash("✅ Medio de pago creado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error creando medio de pago")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder creando el medio de pago.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("medios_pago.listar_medios_pago"))


# ================== ACTUALIZAR MEDIO DE PAGO ==================

@medios_pago_bp.route("/medios-pago/<int:id>/actualizar", methods=["POST"])
def actualizar_medio_pago(id):
    validacion = validar_acceso_medios_pago()
    if validacion:
        return validacion

    data = {
        "nombre": request.form.get("nombre", "").strip(),
        "relacionadocon": request.form.get("relacionadocon", "").strip(),
        "cuentacontable": request.form.get("cuentacontable", "").strip(),
        "mediopagoelectronico": form_bool(
            request.form.get("mediopagoelectronico"),
            default=False
        ),
        "enuso": form_bool(
            request.form.get("enuso"),
            default=True
        ),
        "idsiigo": request.form.get("idsiigo", "").strip(),
    }

    try:
        response = requests.put(
            f"{config.API_URL}/medios/{id}",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            flash("✅ Medio de pago actualizado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error actualizando medio de pago")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder actualizando el medio de pago.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("medios_pago.listar_medios_pago"))


# ================== CAMBIAR ESTADO EN USO ==================

@medios_pago_bp.route("/medios-pago/<int:id>/estado", methods=["POST"])
def cambiar_estado_medio_pago(id):
    validacion = validar_acceso_medios_pago()
    if validacion:
        return validacion

    enuso_actual = form_bool(
        request.form.get("enuso_actual"),
        default=True
    )

    nuevo_enuso = not enuso_actual

    data = {
        "enuso": nuevo_enuso
    }

    try:
        response = requests.patch(
            f"{config.API_URL}/medios/{id}/estado",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            estado_texto = "En uso" if nuevo_enuso else "Inactivo"
            flash(f"✅ Medio de pago cambiado a {estado_texto}", "success")
        else:
            error_msg = get_backend_error(response, "Error cambiando estado del medio de pago")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder cambiando el estado.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("medios_pago.listar_medios_pago"))


# ================== CAMBIAR MEDIO ELECTRÓNICO ==================

@medios_pago_bp.route("/medios-pago/<int:id>/electronico", methods=["POST"])
def cambiar_electronico_medio_pago(id):
    validacion = validar_acceso_medios_pago()
    if validacion:
        return validacion

    electronico_actual = form_bool(
        request.form.get("electronico_actual"),
        default=False
    )

    nuevo_electronico = not electronico_actual

    data = {
        "mediopagoelectronico": nuevo_electronico
    }

    try:
        response = requests.patch(
            f"{config.API_URL}/medios/{id}/electronico",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            estado_texto = "Electrónico" if nuevo_electronico else "No electrónico"
            flash(f"✅ Medio de pago cambiado a {estado_texto}", "success")
        else:
            error_msg = get_backend_error(response, "Error cambiando configuración electrónica")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder cambiando la configuración electrónica.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("medios_pago.listar_medios_pago"))


# ================== ELIMINAR MEDIO DE PAGO ==================

@medios_pago_bp.route("/medios-pago/<int:id>/eliminar", methods=["POST"])
def eliminar_medio_pago(id):
    validacion = validar_acceso_medios_pago()
    if validacion:
        return validacion

    try:
        response = requests.delete(
            f"{config.API_URL}/medios/{id}",
            headers=auth_headers(json=False),
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            flash("✅ Medio de pago eliminado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error eliminando medio de pago")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder eliminando el medio de pago.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("medios_pago.listar_medios_pago"))