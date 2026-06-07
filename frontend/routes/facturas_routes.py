from flask import Blueprint, render_template, session, redirect, url_for, flash, request, jsonify
import requests
import config
from datetime import datetime

facturas_bp = Blueprint("facturas", __name__, url_prefix="/facturas")


# =========================================================
# HELPERS MULTITENANT
# =========================================================

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
        return jsonify({"success": False, "error": "No autorizado"}), 401

    if "idempresa" not in session or not session.get("idempresa"):
        return jsonify({"success": False, "error": "No hay empresa seleccionada"}), 400

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


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def safe_int(value, default=None):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def normalizar_factura_response(data):
    """
    El backend actual puede devolver:
    {
      success: true,
      idfactura,
      cliente,
      detalles,
      pagos
    }

    Esta función deja los datos listos para Jinja.
    """
    if not isinstance(data, dict):
        return {}

    if data.get("success") and "idfactura" in data:
        factura = data
    else:
        factura = data

    try:
        factura["total"] = float(factura.get("total", 0) or 0)
    except Exception:
        factura["total"] = 0.0

    for d in factura.get("detalles", []) or []:
        d["cantidad"] = safe_float(d.get("cantidad"))
        d["valorunitario"] = safe_float(d.get("valorunitario"))
        d["subtotal"] = safe_float(
            d.get("subtotal"),
            d["cantidad"] * d["valorunitario"]
        )

    for p in factura.get("pagos", []) or []:
        p["valor"] = safe_float(p.get("valor"))

    return factura


def construir_payload_factura_desde_form(enviar=False):
    """
    Construye el payload compatible con el backend Node multitenant.
    No envía idusuario ni idempresa.
    """
    data = {
        "idcliente": request.form.get("idcliente"),
        "observaciones": request.form.get("observaciones"),
        "detalles": [],
        "pagos": [],
    }

    if enviar is not None:
        data["enviar"] = enviar

    # ---------- DETALLES ----------
    detalles_temp = {}

    for key, value in request.form.items():
        if key.startswith("detalles["):
            parts = key.replace("detalles[", "").replace("]", "").split("[")
            if len(parts) != 2:
                continue

            index, field = int(parts[0]), parts[1]
            detalles_temp.setdefault(index, {})[field] = value

    for d in detalles_temp.values():
        idproducto = safe_int(d.get("idproducto"))
        cantidad = safe_float(d.get("cantidad"), 0)
        valorunitario = safe_float(d.get("valorunitario"), 0)
        subtotal = cantidad * valorunitario

        if not idproducto:
            continue

        data["detalles"].append({
            "idproducto": idproducto,
            "cantidad": cantidad,
            "valorunitario": valorunitario,
            "subtotal": subtotal,
            "descripcion": d.get("descripcion") or None,
            "descuento": safe_float(d.get("descuento"), 0),
            "impuesto_id": d.get("impuesto_id") or None,
            "impuesto_valor": safe_float(d.get("impuesto_valor"), 0),
        })

    # ---------- PAGOS ----------
    pagos_temp = {}

    for key, value in request.form.items():
        if key.startswith("pagos["):
            parts = key.replace("pagos[", "").replace("]", "").split("[")
            if len(parts) != 2:
                continue

            index, field = int(parts[0]), parts[1]
            pagos_temp.setdefault(index, {})[field] = value

    for p in pagos_temp.values():
        idmedio = p.get("idmedio")

        if idmedio is not None:
            idmedio = str(idmedio).strip()

        valor = safe_float(p.get("valor"), 0)

        if not idmedio and valor <= 0:
            continue

        data["pagos"].append({
            "idmedio": idmedio or None,
            "valor": valor,
            "due_date": p.get("due_date") or None,
            "siigo_pago_id": p.get("siigo_pago_id") or None,
        })

    return data


# =========================================================
# FORMULARIO CREAR FACTURA
# =========================================================
@facturas_bp.route("/crear", methods=["GET"])
def crear_factura_form():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    id_cliente = request.args.get("idCliente")
    identificacion = request.args.get("identificacion")
    id_reserva = request.args.get("idReserva")

    cliente = None
    reserva = None
    productos = []
    medios = []

    try:
        headers = get_headers()

        # =========================================================
        # Buscar reserva por identificación o idReserva
        # =========================================================
        r_reserva = None

        if identificacion:
            r_reserva = requests.get(
                f"{config.API_URL}/reservas/cliente/{identificacion}",
                headers=headers,
                timeout=15
            )

        elif id_reserva:
            r_simple = requests.get(
                f"{config.API_URL}/reservas/{id_reserva}",
                headers=headers,
                timeout=15
            )

            identificacion_cliente = None

            if r_simple.status_code == 200:
                r_data = r_simple.json()

                identificacion_cliente = (
                    r_data.get("identificacion")
                    or r_data.get("identification")
                    or r_data.get("cliente_identificacion")
                )

                if not identificacion_cliente and r_data.get("idcliente"):
                    id_cliente_tmp = r_data.get("idcliente")

                    r_cliente_tmp = requests.get(
                        f"{config.API_URL}/clientes/{id_cliente_tmp}",
                        headers=headers,
                        timeout=15
                    )

                    if r_cliente_tmp.status_code == 200:
                        c_data = r_cliente_tmp.json()
                        identificacion_cliente = (
                            c_data.get("identificacion")
                            or c_data.get("identification")
                            or c_data.get("numero_documento")
                        )

            if identificacion_cliente:
                r_reserva = requests.get(
                    f"{config.API_URL}/reservas/cliente/{identificacion_cliente}",
                    headers=headers,
                    timeout=15
                )
            else:
                r_reserva = r_simple

        # =========================================================
        # Procesar reserva
        # =========================================================
        if r_reserva and r_reserva.status_code == 200:
            data = r_reserva.json()

            if isinstance(data, list) and len(data) > 0:
                reserva = data[0]
            elif isinstance(data, dict):
                reserva = data

            if reserva:
                reserva["nombre_cliente"] = (
                    reserva.get("nombre_cliente")
                    or reserva.get("cliente")
                    or "Cliente no especificado"
                )

                reserva["precio"] = safe_float(
                    reserva.get("precio")
                    or reserva.get("valor")
                    or reserva.get("total")
                )

                reserva["abono"] = safe_float(
                    reserva.get("abono")
                    or reserva.get("pago")
                    or reserva.get("valor_abonado")
                    or reserva.get("valorreserva")
                )

                reserva["producto"] = (
                    reserva.get("producto")
                    or reserva.get("nombre_producto")
                    or "Producto sin nombre"
                )

                reserva["medio"] = (
                    reserva.get("medio")
                    or reserva.get("nombre_medio")
                    or "Sin medio"
                )

                reserva["idcliente"] = reserva.get("idcliente")
                reserva["idmedio"] = reserva.get("idmedio")
                reserva["idproducto"] = reserva.get("idproducto")
                reserva["total"] = reserva["precio"]
                reserva["cantidad"] = 1
                reserva["precio_formateado"] = f"{reserva['precio']:,.2f}"
                reserva["abono_formateado"] = f"{reserva['abono']:,.2f}"

                id_cliente = reserva.get("idcliente")
                identificacion = reserva.get("identificacion")

        # =========================================================
        # Cliente
        # =========================================================
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

        # =========================================================
        # Productos
        # =========================================================
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

        # =========================================================
        # Medios
        # =========================================================
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
        "crear_factura.html",
        cliente=cliente,
        reserva=reserva,
        idCliente=id_cliente,
        idReserva=id_reserva,
        identificacion=identificacion,
        productos=productos,
        medios=medios,
        datetime=datetime,
        empresa_actual=session.get("empresa_actual"),
        empresa_nombre=session.get("empresa_nombre"),
    )


# =========================================================
# LISTAR FACTURAS
# =========================================================
@facturas_bp.route("/", methods=["GET"])
def listar_facturas():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        cliente = request.args.get("cliente", "")
        estado = request.args.get("estado", "")
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 10, type=int)

        if page < 1:
            page = 1

        if per_page not in [10, 25, 50, 100]:
            per_page = 10

        params = {
            "cliente": cliente,
            "estado": estado,
            "page": page,
            "per_page": per_page,
        }

        resp = requests.get(
            f"{config.API_URL}/facturas",
            headers=get_headers(),
            params=params,
            timeout=20
        )

        if resp.status_code == 200:
            data = resp.json()

            facturas = data.get("facturas", [])
            total_pages = int(data.get("total_pages", 1))
            page = int(data.get("page", 1))
            total = int(data.get("total", 0))

            for f in facturas:
                f["total"] = safe_float(f.get("total"), 0)

            return render_template(
                "facturas.html",
                facturas=facturas,
                page=page,
                per_page=per_page,
                total=total,
                total_pages=total_pages,
                request=request,
                cliente=cliente,
                estado=estado,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
            )

        redireccion = manejar_error_backend(resp, "Error obteniendo facturas")
        if redireccion:
            return redireccion

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


# =========================================================
# CREAR FACTURA
# =========================================================
@facturas_bp.route("/crear", methods=["POST"])
def crear_factura():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    id_reserva = request.form.get("idreserva")

    try:
        data = construir_payload_factura_desde_form(enviar=None)

        response = requests.post(
            f"{config.API_URL}/facturas",
            headers=get_headers(json=True),
            json=data,
            timeout=40
        )

        if response.status_code in [200, 201]:
            flash("Factura creada correctamente.", "success")

            # Si viene de una reserva, marcarla como facturada
            if id_reserva:
                patch_resp = requests.patch(
                    f"{config.API_URL}/reservas/{id_reserva}/facturar",
                    headers=get_headers(json=True),
                    timeout=20
                )

                if patch_resp.status_code == 200:
                    flash("Reserva asociada marcada como FACTURADA.", "info")
                else:
                    flash("Factura creada, pero no se actualizó la reserva.", "warning")

        else:
            flash(
                f"Error creando factura: {obtener_mensaje_error(response)}",
                "danger"
            )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder creando la factura.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error enviando factura: {e}", "danger")

    return redirect(url_for("facturas.listar_facturas"))


# =========================================================
# DETALLE DE FACTURA
# =========================================================
@facturas_bp.route("/<int:id>", methods=["GET"])
def detalle_factura(id):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        r = requests.get(
            f"{config.API_URL}/facturas/{id}",
            headers=get_headers(),
            timeout=20
        )

        if r.status_code == 200:
            factura = normalizar_factura_response(r.json())

            return render_template(
                "detalle_factura.html",
                factura=factura,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
            )

        redireccion = manejar_error_backend(r, "Factura no encontrada")
        if redireccion:
            return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error consultando factura: {e}", "danger")

    return redirect(url_for("facturas.listar_facturas"))


# =========================================================
# PROXIES: CLIENTES, PRODUCTOS, MEDIOS, RESERVAS
# =========================================================
@facturas_bp.route("/buscar_cliente", methods=["GET"])
def proxy_buscar_cliente():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    identificacion = request.args.get("identificacion", "")

    try:
        resp = requests.get(
            f"{config.API_URL}/clientes",
            headers=get_headers(),
            params={"identificacion": identificacion},
            timeout=15
        )

        return jsonify(resp.json()) if resp.status_code == 200 else jsonify([])

    except Exception as e:
        print("Error proxy cliente:", e)
        return jsonify([]), 500


@facturas_bp.route("/buscar_productos", methods=["GET"])
def proxy_productos():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/productos",
            headers=get_headers(),
            timeout=15
        )

        return jsonify(resp.json()) if resp.status_code == 200 else jsonify([])

    except Exception as e:
        print("Error proxy productos:", e)
        return jsonify([]), 500


@facturas_bp.route("/buscar_medios", methods=["GET"])
def proxy_medios():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/medios",
            headers=get_headers(),
            timeout=15
        )

        return jsonify(resp.json()) if resp.status_code == 200 else jsonify([])

    except Exception as e:
        print("Error proxy medios:", e)
        return jsonify([]), 500


@facturas_bp.route("/buscar_reserva/<identificacion>", methods=["GET"])
def proxy_buscar_reserva(identificacion):
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/reservas/cliente/{identificacion}",
            headers=get_headers(),
            timeout=15
        )

        if resp.status_code == 200:
            return jsonify(resp.json())

        return jsonify([]), 200

    except Exception as e:
        print("Error proxy reserva:", e)
        return jsonify([]), 500


# =========================================================
# CREAR PREFACTURA
# =========================================================
@facturas_bp.route("/crear_prefactura", methods=["POST"])
def crear_prefactura():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        data = request.get_json() or {}

        # El backend multitenant no necesita idusuario ni idempresa desde el front.
        data.pop("idusuario", None)
        data.pop("idempresa", None)

        backend_url = f"{config.API_URL}/facturas/prefactura"

        resp = requests.post(
            backend_url,
            headers=get_headers(json=True),
            json=data,
            timeout=40
        )

        try:
            payload = resp.json()
        except Exception:
            payload = {
                "success": False,
                "error": resp.text
            }

        return jsonify(payload), resp.status_code

    except Exception as e:
        print("Error creando prefactura:", e)
        return jsonify({
            "success": False,
            "error": "Error creando prefactura"
        }), 500


# =========================================================
# EDITAR PREFACTURA
# =========================================================
@facturas_bp.route("/<int:id>/editar", methods=["GET"])
def facturas_editar_prefactura(id):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        headers = get_headers()

        r = requests.get(
            f"{config.API_URL}/facturas/{id}",
            headers=headers,
            timeout=20
        )

        if r.status_code != 200:
            flash("Prefactura no encontrada.", "danger")
            return redirect(url_for("facturas.listar_facturas"))

        factura = normalizar_factura_response(r.json())

        if factura.get("estado") != "PREFACTURA":
            flash("Solo se pueden editar las prefacturas.", "warning")
            return redirect(url_for("facturas.listar_facturas"))

        r_productos = requests.get(
            f"{config.API_URL}/productos",
            headers=headers,
            timeout=15
        )

        r_medios = requests.get(
            f"{config.API_URL}/medios",
            headers=headers,
            timeout=15
        )

        productos = r_productos.json() if r_productos.status_code == 200 else []
        medios = r_medios.json() if r_medios.status_code == 200 else []

        return render_template(
            "crear_factura.html",
            editar=True,
            factura=factura,
            cliente=factura.get("cliente"),
            detalles=factura.get("detalles", []),
            pagos=factura.get("pagos", []),
            productos=productos,
            medios=medios,
            datetime=datetime,
            empresa_actual=session.get("empresa_actual"),
            empresa_nombre=session.get("empresa_nombre"),
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")
        return redirect(url_for("facturas.listar_facturas"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("facturas.listar_facturas"))

    except Exception as e:
        flash(f"Error editando prefactura: {e}", "danger")
        return redirect(url_for("facturas.listar_facturas"))


# =========================================================
# ENVIAR PREFACTURA A SIIGO
# =========================================================
@facturas_bp.route("/<int:id>/enviar", methods=["POST"])
def enviar_prefactura(id):
    """
    Nota:
    El backend Node ajustado no tiene POST /facturas/:id/enviar.
    El envío se maneja mediante PUT /facturas/prefactura/:id con enviar=true.
    Esta ruta se mantiene por compatibilidad: carga la factura actual,
    reconstruye el payload básico y envía con enviar=true.
    """
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        # Obtener factura completa
        r = requests.get(
            f"{config.API_URL}/facturas/{id}",
            headers=get_headers(),
            timeout=20
        )

        if r.status_code != 200:
            flash("Prefactura no encontrada.", "danger")
            return redirect(url_for("facturas.listar_facturas"))

        factura = normalizar_factura_response(r.json())

        if factura.get("estado") != "PREFACTURA":
            flash("Solo se pueden enviar prefacturas.", "warning")
            return redirect(url_for("facturas.listar_facturas"))

        data = {
            "idcliente": factura.get("idcliente"),
            "observaciones": "",
            "enviar": True,
            "detalles": [],
            "pagos": [],
        }

        for d in factura.get("detalles", []):
            data["detalles"].append({
                "idproducto": d.get("idproducto"),
                "cantidad": safe_float(d.get("cantidad")),
                "valorunitario": safe_float(d.get("valorunitario")),
                "subtotal": safe_float(d.get("subtotal")),
                "descripcion": d.get("descripcion"),
                "descuento": safe_float(d.get("descuento"), 0),
                "impuesto_id": d.get("impuesto_id"),
                "impuesto_valor": safe_float(d.get("impuesto_valor"), 0),
            })

        for p in factura.get("pagos", []):
            data["pagos"].append({
                "idmedio": p.get("idmedio"),
                "valor": safe_float(p.get("valor")),
                "due_date": p.get("due_date"),
                "siigo_pago_id": p.get("siigo_pago_id"),
            })

        resp = requests.put(
            f"{config.API_URL}/facturas/prefactura/{id}",
            headers=get_headers(json=True),
            json=data,
            timeout=45
        )

        if resp.status_code == 200:
            flash("Prefactura enviada exitosamente a Siigo.", "success")
        else:
            flash(
                f"Error enviando prefactura: {obtener_mensaje_error(resp)}",
                "danger"
            )

        return redirect(url_for("facturas.listar_facturas"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder enviando la prefactura.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error enviando prefactura: {e}", "danger")

    return redirect(url_for("facturas.listar_facturas"))


# =========================================================
# ACTUALIZAR PREFACTURA
# =========================================================
@facturas_bp.route("/prefactura/<int:id>/actualizar", methods=["POST"])
def actualizar_prefactura(id):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        enviar = request.form.get("enviar", "false") == "true"
        data = construir_payload_factura_desde_form(enviar=enviar)

        backend_url = f"{config.API_URL}/facturas/prefactura/{id}"

        resp = requests.put(
            backend_url,
            headers=get_headers(json=True),
            json=data,
            timeout=45
        )

        if resp.status_code == 200:
            if enviar:
                flash("Prefactura actualizada y enviada correctamente.", "success")
            else:
                flash("Prefactura actualizada correctamente.", "success")
        else:
            flash(
                f"Error actualizando prefactura: {obtener_mensaje_error(resp)}",
                "danger"
            )

        return redirect(url_for("facturas.listar_facturas"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder actualizando la prefactura.", "danger")
        return redirect(url_for("facturas.listar_facturas"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("facturas.listar_facturas"))

    except Exception as e:
        flash(f"Error actualizando prefactura: {e}", "danger")
        return redirect(url_for("facturas.listar_facturas"))
    
    # =========================================================
# TIRILLA DE FACTURA
# =========================================================
@facturas_bp.route("/<int:id>/tirilla", methods=["GET"])
def imprimir_tirilla_factura(id):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        # Factura
        r = requests.get(
            f"{config.API_URL}/facturas/{id}",
            headers=get_headers(),
            timeout=20
        )

        if r.status_code != 200:
            redireccion = manejar_error_backend(r, "Factura no encontrada")
            if redireccion:
                return redireccion

            return redirect(url_for("facturas.listar_facturas"))

        factura = normalizar_factura_response(r.json())

        # Empresa activa
        empresa_logo_url = None
        empresa_nombre_render = session.get("empresa_nombre")

        r_empresa = requests.get(
            f"{config.API_URL}/empresas/actual",
            headers=get_headers(),
            timeout=15
        )

        if r_empresa.status_code == 200:
            empresa_data = r_empresa.json().get("empresa", {})

            empresa_nombre_render = (
                empresa_data.get("nombre")
                or empresa_nombre_render
            )

            logo_ticket = empresa_data.get("logo_ticket_url")
            logo_general = empresa_data.get("logo_url")

            logo_db = logo_ticket or logo_general

            if logo_db:
                # Si es URL externa, se usa directa.
                if logo_db.startswith("http://") or logo_db.startswith("https://"):
                    empresa_logo_url = logo_db
                else:
                    # Si es ruta relativa dentro de static.
                    empresa_logo_url = url_for("static", filename=logo_db)

        return render_template(
            "tirilla_factura.html",
            factura=factura,
            empresa_actual=session.get("empresa_actual"),
            empresa_nombre=empresa_nombre_render,
            empresa_logo_url=empresa_logo_url,
            username=session.get("username"),
            datetime=datetime,
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error generando tirilla: {e}", "danger")

    return redirect(url_for("facturas.listar_facturas"))
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        r = requests.get(
            f"{config.API_URL}/facturas/{id}",
            headers=get_headers(),
            timeout=20
        )

        if r.status_code == 200:
            factura = normalizar_factura_response(r.json())

            return render_template(
                "tirilla_factura.html",
                factura=factura,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
                username=session.get("username"),
                datetime=datetime,
            )

        redireccion = manejar_error_backend(r, "Factura no encontrada")
        if redireccion:
            return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error generando tirilla: {e}", "danger")

    return redirect(url_for("facturas.listar_facturas"))