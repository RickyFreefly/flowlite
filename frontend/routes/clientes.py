from flask import Blueprint, render_template, request, redirect, url_for, flash, session, jsonify
import requests
import config

clientes_bp = Blueprint("clientes", __name__, url_prefix="/clientes")


def validar_sesion_empresa():
    """
    Valida que exista sesión activa y empresa seleccionada.
    Retorna None si todo está correcto, o una respuesta redirect/json según el caso.
    """
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    if "idempresa" not in session or not session.get("idempresa"):
        flash("No hay una empresa seleccionada para operar.", "warning")
        return redirect(url_for("auth.login"))

    return None


def get_headers(json=False):
    """
    Headers estándar para consumir el backend multitenant.
    """
    headers = {
        "Authorization": f"Bearer {session['token']}",
        "x-empresa-id": session["idempresa"],
    }

    if json:
        headers["Content-Type"] = "application/json"

    return headers


def obtener_mensaje_error(response, mensaje_default="Error procesando la solicitud"):
    """
    Extrae un mensaje claro desde la respuesta del backend.
    """
    try:
        data = response.json()
        return (
            data.get("error")
            or data.get("message")
            or data.get("detail")
            or mensaje_default
        )
    except Exception:
        return response.text or mensaje_default


def manejar_error_backend(response, mensaje_default="Error procesando la solicitud"):
    """
    Maneja errores comunes del backend.
    Retorna una respuesta Flask si debe redirigir, o None si solo debe mostrar flash.
    """
    if response.status_code == 401:
        session.clear()
        flash("La sesión expiró. Inicia sesión nuevamente.", "warning")
        return redirect(url_for("auth.login"))

    if response.status_code == 403:
        flash("No tienes acceso a esta empresa.", "danger")
        return redirect(url_for("dashboard.index"))

    if response.status_code == 400:
        flash(obtener_mensaje_error(response, mensaje_default), "warning")
        return None

    flash(obtener_mensaje_error(response, mensaje_default), "danger")
    return None


# =================== LISTAR CLIENTES (con paginación) ===================
@clientes_bp.route("/")
def listar_clientes():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    identificacion = request.args.get("identificacion", "").strip()
    page = request.args.get("page", 1, type=int)
    per_page = 10
    clientes = []

    try:
        url = f"{config.API_URL}/clientes"
        params = {"identificacion": identificacion} if identificacion else {}

        response = requests.get(
            url,
            headers=get_headers(),
            params=params,
            timeout=15
        )

        if response.status_code == 200:
            clientes = response.json() or []

            if identificacion and not clientes:
                flash("No se encontraron clientes con esa identificación.", "warning")

        else:
            redireccion = manejar_error_backend(
                response,
                "Error obteniendo lista de clientes"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    total = len(clientes)
    total_pages = max((total + per_page - 1) // per_page, 1)

    if page < 1:
        page = 1

    if page > total_pages:
        page = total_pages

    offset = (page - 1) * per_page
    clientes_paginados = clientes[offset:offset + per_page]

    return render_template(
        "clientes.html",
        clientes=clientes_paginados,
        page=page,
        total_pages=total_pages,
        identificacion=identificacion,
        empresa_actual=session.get("empresa_actual"),
        empresa_nombre=session.get("empresa_nombre"),
    )


# =================== CREAR CLIENTE ===================
@clientes_bp.route("/crear", methods=["POST"])
def crear_cliente():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    tipo = (request.form.get("tipo") or "").upper().strip()
    id_type = request.form.get("id_type")
    identificacion = (request.form.get("identificacion") or "").strip()
    check_digit = request.form.get("check_digit")
    nombres = (request.form.get("nombres") or "").upper().strip()
    apellidos = (request.form.get("apellidos") or "").upper().strip()
    razonsocial = (request.form.get("razonSocial") or "").upper().strip()
    direccion = (request.form.get("direccion") or "").upper().strip()
    telefono = request.form.get("telefono")
    contact_email = request.form.get("contact_email")
    observacion = (request.form.get("observacion") or "").upper().strip()
    state_code = request.form.get("state_code")
    city_code = request.form.get("city_code")

    if not identificacion:
        flash("La identificación del cliente es obligatoria.", "warning")
        return redirect(url_for("clientes.listar_clientes"))

    data = {
        "tipo": tipo,
        "id_type": id_type,
        "identificacion": identificacion,
        "check_digit": check_digit,
        "nombres": nombres,
        "apellidos": apellidos,
        "razonsocial": razonsocial,
        "direccion": direccion,
        "country_code": "CO",
        "state_code": state_code,
        "city_code": city_code,
        "telefono": telefono,
        "contact_email": contact_email,
        "observacion": observacion,
    }

    try:
        response = requests.post(
            f"{config.API_URL}/clientes",
            headers=get_headers(json=True),
            json=data,
            timeout=25
        )

        if response.status_code == 201:
            flash("Cliente creado con éxito.", "success")
        else:
            redireccion = manejar_error_backend(
                response,
                "Error creando cliente"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder creando el cliente.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("clientes.listar_clientes"))


# =================== FORMULARIO EDITAR CLIENTE ===================
@clientes_bp.route("/editar/<int:idCliente>")
def editar_cliente_form(idCliente):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        response = requests.get(
            f"{config.API_URL}/clientes/{idCliente}",
            headers=get_headers(),
            timeout=15
        )

        if response.status_code == 200:
            cliente = response.json()
        else:
            redireccion = manejar_error_backend(
                response,
                "Cliente no encontrado"
            )
            if redireccion:
                return redireccion

            return redirect(url_for("clientes.listar_clientes"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")
        return redirect(url_for("clientes.listar_clientes"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("clientes.listar_clientes"))

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("clientes.listar_clientes"))

    return render_template(
        "editar_cliente.html",
        cliente=cliente,
        empresa_actual=session.get("empresa_actual"),
        empresa_nombre=session.get("empresa_nombre"),
    )


# =================== ACTUALIZAR CLIENTE ===================
@clientes_bp.route("/actualizar/<int:idCliente>", methods=["POST"])
def actualizar_cliente(idCliente):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    data = {
        "tipo": (request.form.get("tipo") or "").upper().strip(),
        "id_type": request.form.get("id_type"),
        "nombres": (request.form.get("nombres") or "").upper().strip(),
        "apellidos": (request.form.get("apellidos") or "").upper().strip(),
        "razonsocial": (request.form.get("razonSocial") or "").upper().strip(),
        "direccion": (request.form.get("direccion") or "").upper().strip(),
        "state_code": request.form.get("state_code"),
        "city_code": request.form.get("city_code"),
        "telefono": request.form.get("telefono"),
        "contact_email": request.form.get("contact_email"),
        "observacion": (request.form.get("observacion") or "").upper().strip(),
    }

    try:
        response = requests.put(
            f"{config.API_URL}/clientes/{idCliente}",
            headers=get_headers(json=True),
            json=data,
            timeout=25
        )

        if response.status_code == 200:
            flash("Cliente actualizado con éxito.", "success")
        else:
            redireccion = manejar_error_backend(
                response,
                "Error actualizando cliente"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder actualizando el cliente.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("clientes.listar_clientes"))


# =================== BUSCAR CLIENTE POR IDENTIFICACIÓN (AJAX) ===================
@clientes_bp.route("/buscar", methods=["GET"])
def buscar_cliente():
    if "token" not in session:
        return jsonify({
            "found": False,
            "error": "No autorizado"
        }), 401

    if "idempresa" not in session or not session.get("idempresa"):
        return jsonify({
            "found": False,
            "error": "No hay empresa seleccionada"
        }), 400

    identificacion = request.args.get("identificacion", "").strip()

    if not identificacion:
        return jsonify({
            "found": False,
            "error": "Sin identificación"
        }), 400

    try:
        response = requests.get(
            f"{config.API_URL}/clientes",
            headers=get_headers(),
            params={"identificacion": identificacion},
            timeout=15
        )

        if response.status_code == 200:
            clientes = response.json() or []

            if not clientes:
                return jsonify({"found": False})

            return jsonify({
                "found": True,
                "cliente": clientes[0]
            })

        if response.status_code == 401:
            return jsonify({
                "found": False,
                "error": "Sesión expirada"
            }), 401

        if response.status_code == 403:
            return jsonify({
                "found": False,
                "error": "No tienes acceso a esta empresa"
            }), 403

        return jsonify({
            "found": False,
            "error": obtener_mensaje_error(response, "Error en backend")
        }), response.status_code

    except requests.exceptions.Timeout:
        return jsonify({
            "found": False,
            "error": "El backend tardó demasiado en responder"
        }), 504

    except requests.exceptions.ConnectionError:
        return jsonify({
            "found": False,
            "error": "No fue posible conectar con el backend"
        }), 503

    except Exception as e:
        return jsonify({
            "found": False,
            "error": str(e)
        }), 500