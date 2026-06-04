from flask import Blueprint, render_template, request, redirect, url_for, jsonify, session, flash, Response
import requests
import config
import csv
from io import StringIO

reservas_bp = Blueprint("reservas", __name__, url_prefix="/reservas")


# ================== HELPERS MULTITENANT ==================

def validar_sesion_empresa():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    if "idempresa" not in session or not session.get("idempresa"):
        flash("No hay una empresa seleccionada.", "warning")
        return redirect(url_for("auth.login"))

    return None


def validar_sesion_empresa_json():
    if "token" not in session:
        return jsonify({"error": "No autorizado"}), 401

    if "idempresa" not in session or not session.get("idempresa"):
        return jsonify({"error": "No hay empresa seleccionada"}), 400

    return None


def get_headers(json=False):
    headers = {
        "Authorization": f"Bearer {session['token']}",
        "x-empresa-id": session["idempresa"],
    }

    if json:
        headers["Content-Type"] = "application/json"

    return headers


def obtener_mensaje_error(response, mensaje_default="Error procesando la solicitud"):
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


# ================== GET: Formulario Crear Reserva ==================
@reservas_bp.route("/crear", methods=["GET"])
def crear_reserva_form():
    """
    Muestra el formulario para crear una reserva.
    Puede recibir ?idCliente=xx&identificacion=xxxx desde el listado de clientes.
    """
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    id_cliente = request.args.get("idCliente")
    identificacion = request.args.get("identificacion")

    cliente = None
    productos = []
    medios = []

    try:
        headers = get_headers()

        # Buscar datos del cliente si se pasó idCliente
        if id_cliente:
            r_cliente = requests.get(
                f"{config.API_URL}/clientes/{id_cliente}",
                headers=headers,
                timeout=15
            )

            if r_cliente.status_code == 200:
                cliente = r_cliente.json()
            else:
                redireccion = manejar_error_backend(
                    r_cliente,
                    "No fue posible obtener el cliente"
                )
                if redireccion:
                    return redireccion

        # Productos
        r_prod = requests.get(
            f"{config.API_URL}/productos",
            headers=headers,
            timeout=15
        )

        if r_prod.status_code == 200:
            productos = r_prod.json() or []
        else:
            redireccion = manejar_error_backend(
                r_prod,
                "No fue posible obtener productos"
            )
            if redireccion:
                return redireccion

        # Medios de pago
        r_medios = requests.get(
            f"{config.API_URL}/medios",
            headers=headers,
            timeout=15
        )

        if r_medios.status_code == 200:
            medios = r_medios.json() or []
        else:
            redireccion = manejar_error_backend(
                r_medios,
                "No fue posible obtener medios de pago"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return render_template(
        "reservas.html",
        cliente=cliente,
        idCliente=id_cliente,
        identificacion=identificacion,
        productos=productos,
        medios=medios,
        reservas=[],
        total_pages=1,
        page=1,
        request=request,
        empresa_actual=session.get("empresa_actual"),
        empresa_nombre=session.get("empresa_nombre"),
    )


# ================== GET: Listar Reservas ==================
@reservas_bp.route("/", methods=["GET"])
def listar_reservas():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    fecha_inicio = request.args.get("fecha_inicio")
    fecha_fin = request.args.get("fecha_fin")
    page = request.args.get("page", 1, type=int)
    per_page = 10

    reservas = []
    medios = []
    productos = []
    reservas_pag = []
    total_pages = 1

    try:
        headers = get_headers()

        params = {}
        if fecha_inicio:
            params["fecha_inicio"] = fecha_inicio
        if fecha_fin:
            params["fecha_fin"] = fecha_fin

        # Reservas
        resp = requests.get(
            f"{config.API_URL}/reservas",
            headers=headers,
            params=params,
            timeout=20
        )

        if resp.status_code == 200:
            reservas = resp.json() or []
        else:
            redireccion = manejar_error_backend(
                resp,
                "Error obteniendo reservas"
            )
            if redireccion:
                return redireccion

        # Paginación local
        total = len(reservas)
        total_pages = max((total + per_page - 1) // per_page, 1)

        if page < 1:
            page = 1

        if page > total_pages:
            page = total_pages

        start = (page - 1) * per_page
        end = start + per_page
        reservas_pag = reservas[start:end]

        # Catálogo medios
        medios_resp = requests.get(
            f"{config.API_URL}/medios",
            headers=headers,
            timeout=15
        )

        if medios_resp.status_code == 200:
            medios = medios_resp.json() or []
        else:
            redireccion = manejar_error_backend(
                medios_resp,
                "Error obteniendo medios de pago"
            )
            if redireccion:
                return redireccion

        # Catálogo productos
        productos_resp = requests.get(
            f"{config.API_URL}/productos",
            headers=headers,
            timeout=15
        )

        if productos_resp.status_code == 200:
            productos = productos_resp.json() or []
        else:
            redireccion = manejar_error_backend(
                productos_resp,
                "Error obteniendo productos"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error consultando backend: {e}", "danger")

    return render_template(
        "reservas.html",
        reservas=reservas_pag,
        medios=medios,
        productos=productos,
        request=request,
        page=page,
        total_pages=total_pages,
        empresa_actual=session.get("empresa_actual"),
        empresa_nombre=session.get("empresa_nombre"),
    )


# ================== POST: Crear Reserva ==================
@reservas_bp.route("/crear", methods=["POST"])
def crear_reserva():
    """
    Envía la reserva al backend API.
    Si el idcliente no se envía, busca por identificación.
    """
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        headers = get_headers(json=True)

        idcliente = request.form.get("idCliente") or request.form.get("idcliente")
        identificacion = (request.form.get("identificacion") or "").strip()

        # Si no hay idCliente, buscar por identificación dentro de la empresa activa
        if not idcliente and identificacion:
            cliente_resp = requests.get(
                f"{config.API_URL}/clientes",
                headers=get_headers(),
                params={"identificacion": identificacion},
                timeout=15
            )

            if cliente_resp.status_code != 200:
                redireccion = manejar_error_backend(
                    cliente_resp,
                    "Error buscando cliente"
                )
                if redireccion:
                    return redireccion

                return redirect(url_for("reservas.listar_reservas"))

            cliente_data = cliente_resp.json() or []

            if not cliente_data:
                flash("Cliente no encontrado en la empresa activa.", "warning")
                return redirect(url_for("reservas.listar_reservas"))

            idcliente = cliente_data[0].get("idcliente") or cliente_data[0].get("id")

        if not idcliente:
            flash("Debe seleccionar o identificar un cliente válido.", "warning")
            return redirect(url_for("reservas.listar_reservas"))

        idproducto = request.form.get("idproducto")
        valorreserva = request.form.get("valor")
        idmedio = request.form.get("idmedio")

        if not idproducto or not valorreserva or not idmedio:
            flash("Producto, valor de reserva y medio de pago son obligatorios.", "warning")
            return redirect(url_for("reservas.listar_reservas"))

        data = {
            "idcliente": idcliente,
            "idproducto": idproducto,
            "valorreserva": valorreserva,
            "idmedio": idmedio,
            "observaciones": request.form.get("observaciones", "")
        }

        # El backend ya toma idusuario desde el token. No enviar idusuario desde el front.
        resp = requests.post(
            f"{config.API_URL}/reservas",
            headers=headers,
            json=data,
            timeout=25
        )

        if resp.status_code in [200, 201]:
            flash("Reserva creada correctamente.", "success")
        else:
            redireccion = manejar_error_backend(
                resp,
                "Error creando reserva"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder creando la reserva.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error enviando reserva: {e}", "danger")

    return redirect(url_for("reservas.listar_reservas"))


# ================== GET: Proxy Buscar Clientes ==================
@reservas_bp.route("/clientes", methods=["GET"])
def buscar_clientes():
    """
    Proxy para buscar clientes desde el formulario de reservas por identificación.
    """
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    identificacion = request.args.get("identificacion", "").strip()
    clientes = []

    try:
        params = {}
        if identificacion:
            params["identificacion"] = identificacion

        resp = requests.get(
            f"{config.API_URL}/clientes",
            headers=get_headers(),
            params=params,
            timeout=15
        )

        if resp.status_code == 200:
            clientes = resp.json() or []
            return jsonify(clientes)

        return jsonify({
            "error": obtener_mensaje_error(resp, "Error consultando clientes")
        }), resp.status_code

    except requests.exceptions.Timeout:
        return jsonify({
            "error": "El backend tardó demasiado en responder"
        }), 504

    except requests.exceptions.ConnectionError:
        return jsonify({
            "error": "No fue posible conectar con el backend"
        }), 503

    except Exception as e:
        print("Error consultando backend clientes:", e)
        return jsonify({
            "error": str(e)
        }), 500


# ================== GET: Obtener reserva por ID ==================
@reservas_bp.route("/<int:idreserva>", methods=["GET"])
def obtener_reserva(idreserva):
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/reservas/{idreserva}",
            headers=get_headers(),
            timeout=15
        )

        try:
            data = resp.json()
        except Exception:
            data = {"error": resp.text}

        return jsonify(data), resp.status_code

    except requests.exceptions.Timeout:
        return jsonify({
            "error": "El backend tardó demasiado en responder"
        }), 504

    except requests.exceptions.ConnectionError:
        return jsonify({
            "error": "No fue posible conectar con el backend"
        }), 503

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


# ================== PATCH: Cambiar estado de reserva ==================
@reservas_bp.route("/<int:idreserva>/estado", methods=["POST"])
def actualizar_estado_reserva(idreserva):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    estado = request.form.get("estado")

    if estado not in ["RESERVADO", "FACTURADO", "CANCELADO"]:
        flash("Estado de reserva inválido.", "warning")
        return redirect(url_for("reservas.listar_reservas"))

    try:
        resp = requests.patch(
            f"{config.API_URL}/reservas/{idreserva}/estado",
            headers=get_headers(json=True),
            json={"estado": estado},
            timeout=20
        )

        if resp.status_code == 200:
            flash("Estado de reserva actualizado correctamente.", "success")
        else:
            redireccion = manejar_error_backend(
                resp,
                "Error actualizando estado de reserva"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error actualizando reserva: {e}", "danger")

    return redirect(url_for("reservas.listar_reservas"))


# ================== PATCH: Facturar reserva ==================
@reservas_bp.route("/<int:idreserva>/facturar", methods=["POST"])
def facturar_reserva(idreserva):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        resp = requests.patch(
            f"{config.API_URL}/reservas/{idreserva}/facturar",
            headers=get_headers(json=True),
            timeout=20
        )

        if resp.status_code == 200:
            flash("Reserva marcada como facturada correctamente.", "success")
        else:
            redireccion = manejar_error_backend(
                resp,
                "Error facturando reserva"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error facturando reserva: {e}", "danger")

    return redirect(url_for("reservas.listar_reservas"))


# ================== GET: Exportar Reservas CSV por Fechas ==================
@reservas_bp.route("/exportar", methods=["GET"])
def exportar_reservas_csv():
    """
    Exporta reservas a CSV filtrando por fecha_inicio y fecha_fin.
    """
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    fecha_inicio = request.args.get("fecha_inicio")
    fecha_fin = request.args.get("fecha_fin")

    if not fecha_inicio or not fecha_fin:
        flash("Debe seleccionar un rango de fechas para exportar.", "warning")
        return redirect(url_for("reservas.listar_reservas"))

    try:
        params = {
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin
        }

        resp = requests.get(
            f"{config.API_URL}/reservas",
            headers=get_headers(),
            params=params,
            timeout=30
        )

        if resp.status_code != 200:
            flash(
                f"Error obteniendo reservas para exportar: {obtener_mensaje_error(resp)}",
                "danger"
            )
            return redirect(url_for("reservas.listar_reservas"))

        reservas = resp.json() or []

        output = StringIO()
        writer = csv.writer(output)

        writer.writerow([
            "ID",
            "Fecha",
            "Cliente",
            "Identificación",
            "Producto",
            "Valor",
            "Medio Pago",
            "Estado"
        ])

        for r in reservas:
            writer.writerow([
                r.get("idreserva") or r.get("id") or "",
                str(r.get("fecha", ""))[:10],
                r.get("cliente", ""),
                r.get("identificacion", ""),
                r.get("producto", ""),
                r.get("valorreserva") or r.get("valor") or "",
                r.get("medio", ""),
                r.get("estado", "")
            ])

        csv_content = output.getvalue()
        filename = f"reservas_{fecha_inicio}_a_{fecha_fin}.csv"

        return Response(
            csv_content,
            mimetype="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder generando el CSV.", "danger")
        return redirect(url_for("reservas.listar_reservas"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("reservas.listar_reservas"))

    except Exception as e:
        flash(f"Error generando CSV: {e}", "danger")
        return redirect(url_for("reservas.listar_reservas"))