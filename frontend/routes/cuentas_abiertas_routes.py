# routes/cuentas_abiertas_routes.py
from flask import Blueprint, render_template, session, redirect, url_for, flash, request, jsonify
import requests
import config
from datetime import datetime

cuentas_abiertas_bp = Blueprint(
    "cuentas_abiertas",
    __name__,
    url_prefix="/cuentas-abiertas"
)


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
        return jsonify({
            "success": False,
            "error": "No autorizado"
        }), 401

    if "idempresa" not in session or not session.get("idempresa"):
        return jsonify({
            "success": False,
            "error": "No hay empresa seleccionada"
        }), 400

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

    if response.status_code == 404:
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


def normalizar_cuenta(cuenta):
    if not isinstance(cuenta, dict):
        return {}

    cuenta["saldo_actual"] = safe_float(cuenta.get("saldo_actual"), 0)
    cuenta["total_consumido_no_facturado"] = safe_float(
        cuenta.get("total_consumido_no_facturado"),
        0
    )
    cuenta["total_items_no_facturados"] = safe_int(
        cuenta.get("total_items_no_facturados"),
        0
    )

    return cuenta


def normalizar_movimientos(movimientos):
    if not isinstance(movimientos, list):
        return []

    for m in movimientos:
        m["valor"] = safe_float(m.get("valor"), 0)
        m["saldo_anterior"] = safe_float(m.get("saldo_anterior"), 0)
        m["saldo_nuevo"] = safe_float(m.get("saldo_nuevo"), 0)

    return movimientos


def normalizar_detalles_consumo(detalles):
    if not isinstance(detalles, list):
        return []

    for d in detalles:
        d["cantidad"] = safe_float(d.get("cantidad"), 0)
        d["valorunitario"] = safe_float(d.get("valorunitario"), 0)
        d["subtotal"] = safe_float(d.get("subtotal"), 0)

    return detalles


def normalizar_resumen_mensual(resumen):
    if not isinstance(resumen, list):
        return []

    for r in resumen:
        r["total_consumido"] = safe_float(r.get("total_consumido"), 0)
        r["total_items"] = safe_int(r.get("total_items"), 0)

    return resumen


def construir_payload_consumo_desde_form():
    """
    Construye payload compatible con:
    POST /api/cuentas-abiertas/consumo

    Estructura:
    {
      idcliente,
      fecha_consumo,
      observacion,
      detalles: [{idproducto, cantidad, valorunitario, subtotal}],
      pagos: [{idmedio_pago, valor, observacion}]
    }
    """
    data = {
        "idcliente": safe_int(request.form.get("idcliente")),
        "fecha_consumo": request.form.get("fecha_consumo") or datetime.now().strftime("%Y-%m-%d"),
        "observacion": request.form.get("observacion") or "Consumo registrado desde Flow Lite",
        "detalles": [],
        "pagos": [],
    }

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
        subtotal = safe_float(d.get("subtotal"), cantidad * valorunitario)

        if not idproducto:
            continue

        if cantidad <= 0 or valorunitario < 0:
            continue

        if subtotal <= 0:
            subtotal = cantidad * valorunitario

        data["detalles"].append({
            "idproducto": idproducto,
            "cantidad": cantidad,
            "valorunitario": valorunitario,
            "subtotal": subtotal,
            "descripcion": d.get("descripcion") or None,
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
        idmedio = p.get("idmedio") or p.get("idmedio_pago")
        valor = safe_float(p.get("valor"), 0)

        if idmedio is not None:
            idmedio = str(idmedio).strip()

        if not idmedio and valor <= 0:
            continue

        if valor <= 0:
            continue

        data["pagos"].append({
            "idmedio_pago": idmedio or None,
            "valor": valor,
            "observacion": p.get("observacion") or "Abono registrado con consumo",
        })

    return data


# =========================================================
# LISTAR CUENTAS ABIERTAS
# =========================================================
@cuentas_abiertas_bp.route("/", methods=["GET"])
def listar_cuentas():
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
            f"{config.API_URL}/cuentas-abiertas",
            headers=get_headers(),
            params=params,
            timeout=20
        )

        if resp.status_code == 200:
            data = resp.json()

            cuentas = data.get("cuentas", [])
            resumen = data.get("resumen", {})

            for c in cuentas:
                normalizar_cuenta(c)

            resumen["total_cartera"] = safe_float(
                resumen.get("total_cartera"),
                0
            )
            resumen["cuentas_abiertas"] = safe_int(
                resumen.get("cuentas_abiertas"),
                0
            )
            resumen["cuentas_cerradas"] = safe_int(
                resumen.get("cuentas_cerradas"),
                0
            )
            resumen["total_consumido_mes"] = safe_float(
                resumen.get("total_consumido_mes"),
                0
            )

            total_pages = int(data.get("total_pages", 1))
            page = int(data.get("page", 1))
            total = int(data.get("total", 0))

            return render_template(
                "cuentas_abiertas.html",
                cuentas=cuentas,
                resumen=resumen,
                page=page,
                per_page=per_page,
                total=total,
                total_pages=total_pages,
                cliente=cliente,
                estado=estado,
                request=request,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
                datetime=datetime,
            )

        redireccion = manejar_error_backend(
            resp,
            "Error obteniendo cuentas abiertas"
        )

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
# FORMULARIO REGISTRAR CONSUMO
# =========================================================
@cuentas_abiertas_bp.route("/consumo", methods=["GET"])
def formulario_consumo():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    idcliente = request.args.get("idcliente")
    identificacion = request.args.get("identificacion")

    cliente = None
    cuenta = None
    productos = []
    medios = []

    try:
        headers = get_headers()

        # ---------------------------------------------------------
        # Cliente opcional por ID
        # ---------------------------------------------------------
        if idcliente:
            r_cliente = requests.get(
                f"{config.API_URL}/clientes/{idcliente}",
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

        # ---------------------------------------------------------
        # Cuenta opcional por cliente
        # ---------------------------------------------------------
        if idcliente:
            r_cuenta = requests.get(
                f"{config.API_URL}/cuentas-abiertas/cliente/{idcliente}",
                headers=headers,
                timeout=15
            )

            if r_cuenta.status_code == 200:
                data_cuenta = r_cuenta.json()
                cuenta = data_cuenta.get("cuenta")
                if cuenta:
                    cuenta = normalizar_cuenta(cuenta)

        # ---------------------------------------------------------
        # Productos
        # ---------------------------------------------------------
        r_productos = requests.get(
            f"{config.API_URL}/productos",
            headers=headers,
            timeout=15
        )

        if r_productos.status_code == 200:
            productos = r_productos.json() or []
        else:
            redireccion = manejar_error_backend(
                r_productos,
                "No fue posible obtener productos"
            )
            if redireccion:
                return redireccion

        # ---------------------------------------------------------
        # Medios
        # ---------------------------------------------------------
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

        return render_template(
            "cuenta_abierta_consumo.html",
            cliente=cliente,
            cuenta=cuenta,
            productos=productos,
            medios=medios,
            identificacion=identificacion,
            datetime=datetime,
            empresa_actual=session.get("empresa_actual"),
            empresa_nombre=session.get("empresa_nombre"),
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error cargando formulario de consumo: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.listar_cuentas"))


# =========================================================
# REGISTRAR CONSUMO
# =========================================================
@cuentas_abiertas_bp.route("/consumo", methods=["POST"])
def registrar_consumo():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        payload = construir_payload_consumo_desde_form()

        if not payload.get("idcliente"):
            flash("Debes seleccionar o buscar un cliente.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_consumo"))

        if not payload.get("detalles"):
            flash("Debes agregar al menos un producto o servicio.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_consumo"))

        total_consumo = sum(safe_float(d.get("subtotal"), 0) for d in payload["detalles"])
        total_pagos = sum(safe_float(p.get("valor"), 0) for p in payload["pagos"])

        if total_consumo <= 0:
            flash("El total del consumo debe ser mayor a cero.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_consumo"))

        if total_pagos > total_consumo:
            flash("Los pagos no pueden ser mayores al total consumido.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_consumo"))

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/consumo",
            headers=get_headers(json=True),
            json=payload,
            timeout=35
        )

        if resp.status_code in [200, 201]:
            data = resp.json()
            cuenta = data.get("cuenta", {})
            flash(
                data.get("message", "Consumo registrado correctamente."),
                "success"
            )

            if cuenta.get("idcuenta"):
                return redirect(
                    url_for(
                        "cuentas_abiertas.detalle_cuenta",
                        idcuenta=cuenta.get("idcuenta")
                    )
                )

            return redirect(url_for("cuentas_abiertas.listar_cuentas"))

        flash(
            f"Error registrando consumo: {obtener_mensaje_error(resp)}",
            "danger"
        )

        return redirect(url_for("cuentas_abiertas.formulario_consumo"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder registrando el consumo.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error registrando consumo: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.formulario_consumo"))


# =========================================================
# DETALLE DE CUENTA
# =========================================================
@cuentas_abiertas_bp.route("/<int:idcuenta>", methods=["GET"])
def detalle_cuenta(idcuenta):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/cuentas-abiertas/{idcuenta}",
            headers=get_headers(),
            timeout=20
        )

        if resp.status_code == 200:
            data = resp.json()

            cuenta = normalizar_cuenta(data.get("cuenta", {}))
            movimientos = normalizar_movimientos(data.get("movimientos", []))
            detalles = normalizar_detalles_consumo(data.get("detalles", []))
            resumen_mensual = normalizar_resumen_mensual(data.get("resumen_mensual", []))

            return render_template(
                "cuenta_abierta_detalle.html",
                cuenta=cuenta,
                movimientos=movimientos,
                detalles=detalles,
                resumen_mensual=resumen_mensual,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
                datetime=datetime,
            )

        redireccion = manejar_error_backend(
            resp,
            "Cuenta abierta no encontrada"
        )

        if redireccion:
            return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error consultando cuenta abierta: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.listar_cuentas"))


# =========================================================
# DETALLE DE CUENTA POR CLIENTE
# =========================================================
@cuentas_abiertas_bp.route("/cliente/<int:idcliente>", methods=["GET"])
def detalle_cuenta_cliente(idcliente):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/cuentas-abiertas/cliente/{idcliente}",
            headers=get_headers(),
            timeout=20
        )

        if resp.status_code == 200:
            data = resp.json()

            cuenta = data.get("cuenta")
            movimientos = normalizar_movimientos(data.get("movimientos", []))
            detalles = normalizar_detalles_consumo(data.get("detalles", []))
            resumen_mensual = normalizar_resumen_mensual(data.get("resumen_mensual", []))
            cliente = data.get("cliente", {})

            if cuenta:
                cuenta = normalizar_cuenta(cuenta)

            return render_template(
                "cuenta_abierta_detalle.html",
                cuenta=cuenta,
                cliente=cliente,
                movimientos=movimientos,
                detalles=detalles,
                resumen_mensual=resumen_mensual,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
                datetime=datetime,
            )

        redireccion = manejar_error_backend(
            resp,
            "Cuenta abierta no encontrada para el cliente"
        )

        if redireccion:
            return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error consultando cuenta del cliente: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.listar_cuentas"))


# =========================================================
# FORMULARIO ABONO
# =========================================================
@cuentas_abiertas_bp.route("/<int:idcuenta>/abonar", methods=["GET"])
def formulario_abono(idcuenta):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        headers = get_headers()

        r_cuenta = requests.get(
            f"{config.API_URL}/cuentas-abiertas/{idcuenta}",
            headers=headers,
            timeout=20
        )

        if r_cuenta.status_code != 200:
            redireccion = manejar_error_backend(
                r_cuenta,
                "Cuenta abierta no encontrada"
            )

            if redireccion:
                return redireccion

            return redirect(url_for("cuentas_abiertas.listar_cuentas"))

        data_cuenta = r_cuenta.json()
        cuenta = normalizar_cuenta(data_cuenta.get("cuenta", {}))

        if not cuenta:
            flash("Cuenta abierta no encontrada.", "warning")
            return redirect(url_for("cuentas_abiertas.listar_cuentas"))

        if cuenta.get("estado") == "CERRADA":
            flash("No se pueden registrar abonos sobre una cuenta cerrada.", "warning")
            return redirect(url_for("cuentas_abiertas.detalle_cuenta", idcuenta=idcuenta))

        r_medios = requests.get(
            f"{config.API_URL}/medios",
            headers=headers,
            timeout=15
        )

        medios = r_medios.json() if r_medios.status_code == 200 else []

        return render_template(
            "cuenta_abierta_abono.html",
            cuenta=cuenta,
            medios=medios,
            empresa_actual=session.get("empresa_actual"),
            empresa_nombre=session.get("empresa_nombre"),
            datetime=datetime,
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error cargando formulario de abono: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.listar_cuentas"))


# =========================================================
# REGISTRAR ABONO
# =========================================================
@cuentas_abiertas_bp.route("/<int:idcuenta>/abonar", methods=["POST"])
def registrar_abono(idcuenta):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        idcliente = request.form.get("idcliente")
        valor = safe_float(request.form.get("valor"), 0)
        idmedio_pago = request.form.get("idmedio_pago")
        observacion = request.form.get("observacion", "")

        if not idcliente:
            flash("No se recibió el cliente de la cuenta.", "warning")
            return redirect(url_for("cuentas_abiertas.detalle_cuenta", idcuenta=idcuenta))

        if valor <= 0:
            flash("El valor del abono debe ser mayor a cero.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_abono", idcuenta=idcuenta))

        payload = {
            "idcliente": int(idcliente),
            "valor": valor,
            "idmedio_pago": idmedio_pago or None,
            "observacion": observacion or "Abono registrado desde Flow Lite",
        }

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/abono",
            headers=get_headers(json=True),
            json=payload,
            timeout=25
        )

        if resp.status_code in [200, 201]:
            data = resp.json()
            flash(data.get("message", "Abono registrado correctamente."), "success")
            return redirect(url_for("cuentas_abiertas.detalle_cuenta", idcuenta=idcuenta))

        flash(
            f"Error registrando abono: {obtener_mensaje_error(resp)}",
            "danger"
        )

        return redirect(url_for("cuentas_abiertas.formulario_abono", idcuenta=idcuenta))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder registrando el abono.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error registrando abono: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.formulario_abono", idcuenta=idcuenta))


# =========================================================
# REGISTRAR CARGO MANUAL
# =========================================================
@cuentas_abiertas_bp.route("/cargo", methods=["POST"])
def registrar_cargo_manual():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        idcliente = request.form.get("idcliente")
        valor = safe_float(request.form.get("valor"), 0)
        observacion = request.form.get("observacion", "")

        if not idcliente:
            flash("Debes seleccionar un cliente.", "warning")
            return redirect(url_for("cuentas_abiertas.listar_cuentas"))

        if valor <= 0:
            flash("El valor del cargo debe ser mayor a cero.", "warning")
            return redirect(url_for("cuentas_abiertas.listar_cuentas"))

        payload = {
            "idcliente": int(idcliente),
            "valor": valor,
            "observacion": observacion or "Cargo manual registrado desde Flow Lite",
        }

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/cargo",
            headers=get_headers(json=True),
            json=payload,
            timeout=25
        )

        if resp.status_code in [200, 201]:
            data = resp.json()
            cuenta = data.get("cuenta", {})
            flash(data.get("message", "Cargo registrado correctamente."), "success")

            if cuenta.get("idcuenta"):
                return redirect(
                    url_for(
                        "cuentas_abiertas.detalle_cuenta",
                        idcuenta=cuenta.get("idcuenta")
                    )
                )

            return redirect(url_for("cuentas_abiertas.listar_cuentas"))

        flash(
            f"Error registrando cargo: {obtener_mensaje_error(resp)}",
            "danger"
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder registrando el cargo.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error registrando cargo: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.listar_cuentas"))


# =========================================================
# FORMULARIO AJUSTE
# =========================================================
@cuentas_abiertas_bp.route("/<int:idcuenta>/ajustar", methods=["GET"])
def formulario_ajuste(idcuenta):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/cuentas-abiertas/{idcuenta}",
            headers=get_headers(),
            timeout=20
        )

        if resp.status_code == 200:
            data = resp.json()
            cuenta = normalizar_cuenta(data.get("cuenta", {}))

            return render_template(
                "cuenta_abierta_ajuste.html",
                cuenta=cuenta,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
                datetime=datetime,
            )

        redireccion = manejar_error_backend(resp, "Cuenta abierta no encontrada")

        if redireccion:
            return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error cargando formulario de ajuste: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.listar_cuentas"))


# =========================================================
# REGISTRAR AJUSTE
# =========================================================
@cuentas_abiertas_bp.route("/<int:idcuenta>/ajustar", methods=["POST"])
def registrar_ajuste(idcuenta):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        idcliente = request.form.get("idcliente")
        saldo_nuevo = safe_float(request.form.get("saldo_nuevo"), -1)
        observacion = request.form.get("observacion", "")

        if not idcliente:
            flash("No se recibió el cliente de la cuenta.", "warning")
            return redirect(url_for("cuentas_abiertas.detalle_cuenta", idcuenta=idcuenta))

        if saldo_nuevo < 0:
            flash("El saldo nuevo debe ser mayor o igual a cero.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_ajuste", idcuenta=idcuenta))

        if not observacion.strip():
            flash("La observación es obligatoria para realizar ajustes.", "warning")
            return redirect(url_for("cuentas_abiertas.formulario_ajuste", idcuenta=idcuenta))

        payload = {
            "idcliente": int(idcliente),
            "saldo_nuevo": saldo_nuevo,
            "observacion": observacion,
        }

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/ajuste",
            headers=get_headers(json=True),
            json=payload,
            timeout=25
        )

        if resp.status_code in [200, 201]:
            data = resp.json()
            flash(data.get("message", "Ajuste registrado correctamente."), "success")
            return redirect(url_for("cuentas_abiertas.detalle_cuenta", idcuenta=idcuenta))

        flash(
            f"Error registrando ajuste: {obtener_mensaje_error(resp)}",
            "danger"
        )

        return redirect(url_for("cuentas_abiertas.formulario_ajuste", idcuenta=idcuenta))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder registrando el ajuste.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error registrando ajuste: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.formulario_ajuste", idcuenta=idcuenta))


# =========================================================
# CERRAR CUENTA
# =========================================================
@cuentas_abiertas_bp.route("/<int:idcuenta>/cerrar", methods=["POST"])
def cerrar_cuenta(idcuenta):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/{idcuenta}/cerrar",
            headers=get_headers(json=True),
            timeout=20
        )

        if resp.status_code == 200:
            data = resp.json()
            flash(data.get("message", "Cuenta cerrada correctamente."), "success")
        else:
            flash(
                f"Error cerrando cuenta: {obtener_mensaje_error(resp)}",
                "danger"
            )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder cerrando la cuenta.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error cerrando cuenta: {e}", "danger")

    return redirect(url_for("cuentas_abiertas.detalle_cuenta", idcuenta=idcuenta))


# =========================================================
# PROXY JSON: BUSCAR CUENTA POR CLIENTE
# =========================================================
@cuentas_abiertas_bp.route("/buscar_cliente/<int:idcliente>", methods=["GET"])
def proxy_cuenta_cliente(idcliente):
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        resp = requests.get(
            f"{config.API_URL}/cuentas-abiertas/cliente/{idcliente}",
            headers=get_headers(),
            timeout=15
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
        print("Error proxy cuenta cliente:", e)
        return jsonify({
            "success": False,
            "error": "Error consultando cuenta del cliente"
        }), 500


# =========================================================
# PROXY JSON: PRODUCTOS
# =========================================================
@cuentas_abiertas_bp.route("/buscar_productos", methods=["GET"])
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
        print("Error proxy productos cuenta abierta:", e)
        return jsonify([]), 500


# =========================================================
# PROXY JSON: MEDIOS
# =========================================================
@cuentas_abiertas_bp.route("/buscar_medios", methods=["GET"])
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
        print("Error proxy medios cuenta abierta:", e)
        return jsonify([]), 500


# =========================================================
# PROXY JSON: REGISTRAR CONSUMO
# Útil si luego quieres enviar desde AJAX
# =========================================================
@cuentas_abiertas_bp.route("/api/consumo", methods=["POST"])
def proxy_consumo_json():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        data = request.get_json() or {}

        data.pop("idempresa", None)
        data.pop("idusuario", None)

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/consumo",
            headers=get_headers(json=True),
            json=data,
            timeout=35
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
        print("Error proxy consumo cuenta abierta:", e)
        return jsonify({
            "success": False,
            "error": "Error registrando consumo"
        }), 500


# =========================================================
# PROXY JSON: REGISTRAR ABONO
# Útil para modales AJAX desde el HTML
# =========================================================
@cuentas_abiertas_bp.route("/api/abono", methods=["POST"])
def proxy_abono_json():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        data = request.get_json() or {}

        data.pop("idempresa", None)
        data.pop("idusuario", None)

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/abono",
            headers=get_headers(json=True),
            json=data,
            timeout=25
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
        print("Error proxy abono cuenta abierta:", e)
        return jsonify({
            "success": False,
            "error": "Error registrando abono"
        }), 500


# =========================================================
# PROXY JSON: REGISTRAR CARGO
# Útil para integrarlo luego con facturas
# =========================================================
@cuentas_abiertas_bp.route("/api/cargo", methods=["POST"])
def proxy_cargo_json():
    validacion = validar_sesion_empresa_json()
    if validacion:
        return validacion

    try:
        data = request.get_json() or {}

        data.pop("idempresa", None)
        data.pop("idusuario", None)

        resp = requests.post(
            f"{config.API_URL}/cuentas-abiertas/cargo",
            headers=get_headers(json=True),
            json=data,
            timeout=25
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
        print("Error proxy cargo cuenta abierta:", e)
        return jsonify({
            "success": False,
            "error": "Error registrando cargo"
        }), 500