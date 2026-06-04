from flask import Blueprint, render_template, session, redirect, url_for, flash, request, Response
import requests
import config
from datetime import datetime
import csv
from io import StringIO

# Blueprint correcto para url_for('egresos.xxx')
egresos_bp = Blueprint("egresos", __name__, url_prefix="/egresos")


# ================== HELPERS MULTITENANT ==================

def validar_sesion_empresa():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    if "idempresa" not in session or not session.get("idempresa"):
        flash("No hay una empresa seleccionada.", "warning")
        return redirect(url_for("auth.login"))

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


# ================== LISTAR EGRESOS ==================
@egresos_bp.route("/", methods=["GET"])
def listar_egresos():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    proveedor_busqueda = (request.args.get("proveedor") or "").strip()
    fecha_inicio = request.args.get("fecha_inicio")
    fecha_fin = request.args.get("fecha_fin")

    page = request.args.get("page", 1, type=int)
    per_page = 10

    if page < 1:
        page = 1

    egresos = []
    egresos_pagina = []
    total_pages = 1

    try:
        params = {}

        if proveedor_busqueda:
            params["proveedor"] = proveedor_busqueda

        if fecha_inicio:
            params["fecha_inicio"] = fecha_inicio

        if fecha_fin:
            params["fecha_fin"] = fecha_fin

        response = requests.get(
            f"{config.API_URL}/egresos",
            headers=get_headers(),
            params=params,
            timeout=20
        )

        if response.status_code != 200:
            redireccion = manejar_error_backend(
                response,
                "Error al obtener egresos"
            )
            if redireccion:
                return redireccion

            egresos = []
        else:
            egresos = response.json() or []

        total = len(egresos)
        total_pages = max((total + per_page - 1) // per_page, 1)

        if page > total_pages:
            page = total_pages

        start = (page - 1) * per_page
        end = start + per_page
        egresos_pagina = egresos[start:end]

        fecha_actual = datetime.now().strftime("%Y-%m-%d")

        return render_template(
            "egresos.html",
            egresos=egresos_pagina,
            fecha_actual=fecha_actual,
            page=page,
            total_pages=total_pages,
            proveedor_busqueda=proveedor_busqueda,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
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


# ================== CREAR EGRESO ==================
@egresos_bp.route("/nuevo", methods=["POST"])
def crear_egreso():
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    fecha_actual = datetime.now().strftime("%Y-%m-%d")

    data = {
        "fecha": fecha_actual,
        "concepto": request.form.get("concepto", "").strip(),
        "proveedor": request.form.get("proveedor", "").strip(),
        "valor": request.form.get("valor", "").strip(),
        "metodopago": request.form.get("metodopago", "").strip(),
        "observacion": request.form.get("observacion", "").strip(),
    }

    # El backend ya toma createdby desde el JWT. No enviar idusuario desde el front.

    if not data["concepto"] or not data["proveedor"] or not data["valor"] or not data["metodopago"]:
        flash("Concepto, proveedor, valor y método de pago son obligatorios.", "warning")
        return redirect(url_for("egresos.listar_egresos"))

    try:
        response = requests.post(
            f"{config.API_URL}/egresos",
            headers=get_headers(json=True),
            json=data,
            timeout=20
        )

        if response.status_code in (200, 201):
            flash("Egreso creado correctamente.", "success")
        else:
            redireccion = manejar_error_backend(
                response,
                "Error al crear egreso"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder creando el egreso.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("egresos.listar_egresos"))


# ================== DETALLE DE EGRESO ==================
@egresos_bp.route("/<int:id>", methods=["GET"])
def detalle_egreso(id):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    try:
        response = requests.get(
            f"{config.API_URL}/egresos/{id}",
            headers=get_headers(),
            timeout=15
        )

        if response.status_code == 200:
            egreso = response.json()
            return render_template(
                "egreso_detalle.html",
                egreso=egreso,
                empresa_actual=session.get("empresa_actual"),
                empresa_nombre=session.get("empresa_nombre"),
            )

        redireccion = manejar_error_backend(
            response,
            "Egreso no encontrado"
        )
        if redireccion:
            return redireccion

        return redirect(url_for("egresos.listar_egresos"))

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")
        return redirect(url_for("egresos.listar_egresos"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("egresos.listar_egresos"))

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("egresos.listar_egresos"))


# ================== CAMBIAR ESTADO DE EGRESO ==================
@egresos_bp.route("/<int:id>/estado", methods=["POST"])
def cambiar_estado_egreso(id):
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    estado = request.form.get("estado", "").strip().upper()

    if estado not in ["PENDIENTE", "PAGADO", "ANULADO"]:
        flash("Estado inválido.", "warning")
        return redirect(url_for("egresos.listar_egresos"))

    try:
        response = requests.patch(
            f"{config.API_URL}/egresos/{id}/estado",
            headers=get_headers(json=True),
            json={"estado": estado},
            timeout=20
        )

        if response.status_code == 200:
            flash("Estado del egreso actualizado correctamente.", "success")
        else:
            redireccion = manejar_error_backend(
                response,
                "Error actualizando estado del egreso"
            )
            if redireccion:
                return redireccion

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder.", "danger")

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")

    except Exception as e:
        flash(f"Error actualizando egreso: {e}", "danger")

    return redirect(url_for("egresos.listar_egresos"))


# ================== EXPORTAR EGRESOS CSV POR FECHAS ==================
@egresos_bp.route("/exportar", methods=["GET"])
def exportar_egresos_csv():
    """
    Este endpoint es el que tu template llama con:
    url_for('egresos.exportar_egresos_csv')
    """
    validacion = validar_sesion_empresa()
    if validacion:
        return validacion

    fecha_inicio = request.args.get("fecha_inicio")
    fecha_fin = request.args.get("fecha_fin")

    if not fecha_inicio or not fecha_fin:
        flash("Debe seleccionar un rango de fechas para exportar.", "warning")
        return redirect(url_for("egresos.listar_egresos"))

    try:
        params = {
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin
        }

        resp = requests.get(
            f"{config.API_URL}/egresos",
            headers=get_headers(),
            params=params,
            timeout=30
        )

        if resp.status_code != 200:
            redireccion = manejar_error_backend(
                resp,
                "Error obteniendo egresos para exportar"
            )
            if redireccion:
                return redireccion

            return redirect(url_for("egresos.listar_egresos"))

        egresos = resp.json() or []

        output = StringIO()
        writer = csv.writer(output)

        writer.writerow([
            "ID",
            "Fecha",
            "Concepto",
            "Proveedor",
            "Valor",
            "Método Pago",
            "Usuario",
            "Observación"
        ])

        for e in egresos:
            writer.writerow([
                e.get("idegreso", ""),
                str(e.get("fecha", ""))[:10],
                e.get("concepto", ""),
                e.get("proveedor", ""),
                e.get("valor", ""),
                e.get("metodopago", ""),
                e.get("usuario", ""),
                e.get("observacion", "")
            ])

        csv_content = output.getvalue()
        filename = f"egresos_{fecha_inicio}_a_{fecha_fin}.csv"

        return Response(
            csv_content,
            mimetype="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

    except requests.exceptions.Timeout:
        flash("El backend tardó demasiado en responder generando el CSV.", "danger")
        return redirect(url_for("egresos.listar_egresos"))

    except requests.exceptions.ConnectionError:
        flash("No fue posible conectar con el backend.", "danger")
        return redirect(url_for("egresos.listar_egresos"))

    except Exception as e:
        flash(f"Error generando CSV: {e}", "danger")
        return redirect(url_for("egresos.listar_egresos"))