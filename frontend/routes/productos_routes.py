# routes/productos_routes.py
from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config

productos_bp = Blueprint("productos", __name__)


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
        "x-empresa-id": session["idempresa"],
    }

    if json:
        headers["Content-Type"] = "application/json"

    return headers


def get_current_role():
    return str(session.get("rol", "")).strip().upper()


def is_current_user_admin():
    return get_current_role() == "ADMIN"


def user_can_manage_products():
    """
    Permite administrar productos a usuarios ADMIN.
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


def safe_float(value):
    try:
        if value is None or value == "":
            return 0
        return float(value)
    except Exception:
        return 0


def validar_acceso_productos():
    """
    Valida sesión, empresa activa y permisos.
    """
    if not require_login():
        return redirect(url_for("auth.login"))

    if not require_empresa():
        return redirect(url_for("auth.login"))

    if not user_can_manage_products():
        flash("No tienes permiso para administrar productos.", "danger")
        return redirect(url_for("dashboard.index"))

    return None


# ================== LISTAR PRODUCTOS ==================

@productos_bp.route("/productos")
def listar_productos():
    validacion = validar_acceso_productos()
    if validacion:
        return validacion

    buscar = request.args.get("buscar", "").strip()
    estado = request.args.get("estado", "").strip()
    tipo = request.args.get("tipo", "").strip()
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

        if estado:
            params["estado"] = estado

        if tipo:
            params["tipo"] = tipo

        response = requests.get(
            f"{config.API_URL}/productos",
            headers=auth_headers(json=False),
            params=params,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code != 200:
            error_msg = get_backend_error(response, "Error al obtener productos")
            flash(f"❌ {error_msg}", "danger")

            productos = []
            pagination = {
                "page": 1,
                "limit": limit,
                "total": 0,
                "total_pages": 1,
            }
            resumen = {
                "total_productos": 0,
                "total_activos": 0,
                "total_inactivos": 0,
            }
        else:
            payload = response.json()

            productos = payload.get("data", [])
            pagination = payload.get("pagination", {})
            resumen = payload.get("resumen", {})

            if not isinstance(productos, list):
                productos = []

        producto_editar = None

        if editar_id:
            response_edit = requests.get(
                f"{config.API_URL}/productos/{editar_id}",
                headers=auth_headers(json=False),
                timeout=15
            )

            redireccion = handle_auth_or_company_error(response_edit)
            if redireccion:
                return redireccion

            if response_edit.status_code == 200:
                producto_editar = response_edit.json()
            else:
                error_msg = get_backend_error(response_edit, "Producto no encontrado")
                flash(f"❌ {error_msg}", "warning")

        return render_template(
            "productos.html",
            productos=productos,
            producto_editar=producto_editar,
            buscar=buscar,
            estado=estado,
            tipo=tipo,

            total_productos=resumen.get("total_productos", 0),
            total_activos=resumen.get("total_activos", 0),
            total_inactivos=resumen.get("total_inactivos", 0),

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


# ================== CREAR PRODUCTO ==================

@productos_bp.route("/productos/crear", methods=["POST"])
def crear_producto():
    validacion = validar_acceso_productos()
    if validacion:
        return validacion

    data = {
        "codigo": request.form.get("codigo", "").strip(),
        "nombre": request.form.get("nombre", "").strip(),
        "tipo": request.form.get("tipo", "").strip(),
        "unidad": request.form.get("unidad", "").strip(),
        "precio": safe_float(request.form.get("precio")),
        "impuestos": safe_float(request.form.get("impuestos")),
        "estado": request.form.get("estado", "Activo").strip() or "Activo",
    }

    try:
        response = requests.post(
            f"{config.API_URL}/productos",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code in (200, 201):
            flash("✅ Producto creado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error creando producto")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder creando el producto.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("productos.listar_productos"))


# ================== ACTUALIZAR PRODUCTO ==================

@productos_bp.route("/productos/<int:id>/actualizar", methods=["POST"])
def actualizar_producto(id):
    validacion = validar_acceso_productos()
    if validacion:
        return validacion

    data = {
        "codigo": request.form.get("codigo", "").strip(),
        "nombre": request.form.get("nombre", "").strip(),
        "tipo": request.form.get("tipo", "").strip(),
        "unidad": request.form.get("unidad", "").strip(),
        "precio": safe_float(request.form.get("precio")),
        "impuestos": safe_float(request.form.get("impuestos")),
        "estado": request.form.get("estado", "Activo").strip() or "Activo",
    }

    try:
        response = requests.put(
            f"{config.API_URL}/productos/{id}",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            flash("✅ Producto actualizado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error actualizando producto")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder actualizando el producto.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("productos.listar_productos"))


# ================== CAMBIAR ESTADO ==================

@productos_bp.route("/productos/<int:id>/estado", methods=["POST"])
def cambiar_estado_producto(id):
    validacion = validar_acceso_productos()
    if validacion:
        return validacion

    estado_actual = request.form.get("estado_actual", "").strip().upper()

    nuevo_estado = "Inactivo"
    if estado_actual == "INACTIVO":
        nuevo_estado = "Activo"

    data = {
        "estado": nuevo_estado
    }

    try:
        response = requests.patch(
            f"{config.API_URL}/productos/{id}/estado",
            headers=auth_headers(json=True),
            json=data,
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            flash(f"✅ Producto cambiado a {nuevo_estado}", "success")
        else:
            error_msg = get_backend_error(response, "Error cambiando estado del producto")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder cambiando el estado.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("productos.listar_productos"))


# ================== ELIMINAR PRODUCTO ==================

@productos_bp.route("/productos/<int:id>/eliminar", methods=["POST"])
def eliminar_producto(id):
    validacion = validar_acceso_productos()
    if validacion:
        return validacion

    try:
        response = requests.delete(
            f"{config.API_URL}/productos/{id}",
            headers=auth_headers(json=False),
            timeout=20
        )

        redireccion = handle_auth_or_company_error(response)
        if redireccion:
            return redireccion

        if response.status_code == 200:
            flash("✅ Producto eliminado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error eliminando producto")
            flash(f"❌ {error_msg}", "danger")

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder eliminando el producto.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("productos.listar_productos"))