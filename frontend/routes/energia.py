from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config
from datetime import datetime, date, timedelta
import calendar

energia_bp = Blueprint("energia", __name__)


# ================== HELPERS ==================

def auth_headers():
    return {
        "Authorization": f"Bearer {session['token']}",
        "Content-Type": "application/json"
    }


def get_current_month_range():
    """
    Rango de mes calendario.
    Se deja disponible por compatibilidad, aunque el resumen ahora usa periodo 21 a 21.
    """
    today = date.today()
    first_day = today.replace(day=1)
    last_day = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    return first_day.strftime("%Y-%m-%d"), last_day.strftime("%Y-%m-%d")


def add_one_month(fecha):
    """
    Suma un mes conservando el día.
    Para este módulo se usa principalmente el día 21.
    """
    year = fecha.year
    month = fecha.month + 1

    if month > 12:
        month = 1
        year += 1

    return date(year, month, fecha.day)


def subtract_one_month(fecha):
    """
    Resta un mes conservando el día.
    Para este módulo se usa principalmente el día 21.
    """
    year = fecha.year
    month = fecha.month - 1

    if month < 1:
        month = 12
        year -= 1

    return date(year, month, fecha.day)


def get_current_billing_period_range():
    """
    Periodo de facturación / lectura:
    del día 21 de un mes al día 21 del mes siguiente.

    Reglas:
    - Si hoy es antes del 21:
      periodo = 21 del mes anterior al 21 del mes actual.

    - Si hoy es 21 o posterior:
      periodo = 21 del mes actual al 21 del mes siguiente.
    """
    today = date.today()

    if today.day >= 21:
        start_date = date(today.year, today.month, 21)
        end_date = add_one_month(start_date)
    else:
        end_date = date(today.year, today.month, 21)
        start_date = subtract_one_month(end_date)

    return start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d")


def safe_float(value):
    try:
        if value is None or value == "":
            return 0
        return float(value)
    except Exception:
        return 0


def parse_date_yyyy_mm_dd(value):
    try:
        if not value:
            return None

        value = str(value).strip()[:10]
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def daterange(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def is_operational_weekday(fecha):
    """
    Días normales de operación:
    - Miércoles
    - Jueves
    - Viernes
    - Sábado
    - Domingo

    Python:
    lunes=0, martes=1, miércoles=2, jueves=3,
    viernes=4, sábado=5, domingo=6.
    """
    return fecha.weekday() in [2, 3, 4, 5, 6]


def normalize_estado(value):
    return str(value or "").strip().upper()


def require_login():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return False
    return True


def get_current_role():
    return str(session.get("rol", "")).strip().upper()


def is_current_user_admin():
    return get_current_role() == "ADMIN"


def user_can_access_energy():
    """
    Permite acceso al módulo de energía a:
    - ADMIN: acceso total.
    - ENERGIA: acceso exclusivo al módulo de energía.
    - Usuarios específicos heredados: idusuario 5 y 6.
    """
    rol = get_current_role()
    idusuario = session.get("idusuario")

    if rol in ["ADMIN", "ENERGIA"]:
        return True

    if idusuario in [5, 6]:
        return True

    return False


def get_backend_error(response, default_message):
    """
    Extrae un mensaje útil desde el backend Node.
    """
    try:
        data = response.json()
        return data.get("error") or data.get("message") or default_message
    except Exception:
        return f"{default_message}. Status: {response.status_code}"


# ================== LISTAR REGISTROS DE ENERGÍA ==================

@energia_bp.route("/energia")
def listar_energia():
    if not require_login():
        return redirect(url_for("auth.login"))

    if not user_can_access_energy():
        flash("No tienes permiso para acceder al control de energía.", "danger")
        return redirect(url_for("dashboard.index"))

    fecha_inicio = request.args.get("fecha_inicio")
    fecha_fin = request.args.get("fecha_fin")
    estado = request.args.get("estado", "")

    # Ajustado a periodo de facturación 21 a 21
    if not fecha_inicio or not fecha_fin:
        fecha_inicio, fecha_fin = get_current_billing_period_range()

    try:
        params = {
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin,
        }

        if estado:
            params["estado"] = estado

        response = requests.get(
            f"{config.API_URL}/energia/registros",
            headers=auth_headers(),
            params=params
        )

        if response.status_code != 200:
            error_msg = get_backend_error(response, "Error al obtener registros de energía")
            flash(f"❌ {error_msg}", "danger")
            return redirect(url_for("dashboard.index"))

        registros = response.json()

        if not isinstance(registros, list):
            registros = []

        total_consumo = sum(safe_float(r.get("consumo_total_kwh")) for r in registros)
        total_gravity = sum(safe_float(r.get("consumo_gravity_kwh")) for r in registros)
        total_zona_cero = sum(safe_float(r.get("consumo_zona_cero_kwh")) for r in registros)
        total_identificado = sum(safe_float(r.get("consumo_identificado_kwh")) for r in registros)
        total_restante = sum(safe_float(r.get("consumo_restante_kwh")) for r in registros)

        costo_total = sum(safe_float(r.get("costo_total")) for r in registros)
        costo_gravity = sum(safe_float(r.get("costo_gravity")) for r in registros)
        costo_zona_cero = sum(safe_float(r.get("costo_zona_cero")) for r in registros)
        costo_identificado = sum(safe_float(r.get("costo_identificado")) for r in registros)
        costo_restante = sum(safe_float(r.get("costo_restante")) for r in registros)

        fecha_actual = datetime.now().strftime("%Y-%m-%d")
        fecha_formulario = request.args.get("fecha") or ""

        return render_template(
            "energia.html",
            registros=registros,
            fecha_actual=fecha_actual,
            fecha_formulario=fecha_formulario,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
            estado=estado,

            total_consumo=total_consumo,
            total_gravity=total_gravity,
            total_zona_cero=total_zona_cero,
            total_identificado=total_identificado,
            total_restante=total_restante,

            costo_total=costo_total,
            costo_gravity=costo_gravity,
            costo_zona_cero=costo_zona_cero,
            costo_identificado=costo_identificado,
            costo_restante=costo_restante,

            is_admin=is_current_user_admin()
        )

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("dashboard.index"))


# ================== ABRIR DÍA ==================

@energia_bp.route("/energia/abrir-dia", methods=["POST"])
def abrir_dia_energia():
    if not require_login():
        return redirect(url_for("auth.login"))

    if not user_can_access_energy():
        flash("No tienes permiso para abrir registros de energía.", "danger")
        return redirect(url_for("dashboard.index"))

    data = {
        "fecha": request.form.get("fecha"),
        "lectura_inicial_total": request.form.get("lectura_inicial_total"),
        "lectura_inicial_gravity": request.form.get("lectura_inicial_gravity"),
        "lectura_inicial_zona_cero": request.form.get("lectura_inicial_zona_cero"),
        "valor_kwh": request.form.get("valor_kwh") or 1000,
        "observaciones": request.form.get("observaciones", ""),
    }

    try:
        response = requests.post(
            f"{config.API_URL}/energia/abrir-dia",
            headers=auth_headers(),
            json=data
        )

        if response.status_code in (200, 201):
            flash("✅ Día de energía abierto correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error al abrir día de energía")
            flash(f"❌ {error_msg}", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("energia.listar_energia"))


# ================== CERRAR DÍA ==================

@energia_bp.route("/energia/<int:id>/cerrar-dia", methods=["POST"])
def cerrar_dia_energia(id):
    if not require_login():
        return redirect(url_for("auth.login"))

    if not user_can_access_energy():
        flash("No tienes permiso para cerrar registros de energía.", "danger")
        return redirect(url_for("dashboard.index"))

    data = {
        "lectura_final_total": request.form.get("lectura_final_total"),
        "lectura_final_gravity": request.form.get("lectura_final_gravity"),
        "lectura_final_zona_cero": request.form.get("lectura_final_zona_cero"),
        "observaciones": request.form.get("observaciones", ""),
    }

    try:
        response = requests.put(
            f"{config.API_URL}/energia/{id}/cerrar-dia",
            headers=auth_headers(),
            json=data
        )

        if response.status_code in (200, 201):
            flash("✅ Día de energía cerrado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error al cerrar día de energía")
            flash(f"❌ {error_msg}", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("energia.listar_energia"))


# ================== DETALLE DE REGISTRO ==================

@energia_bp.route("/energia/<int:id>")
def detalle_energia(id):
    if not require_login():
        return redirect(url_for("auth.login"))

    if not user_can_access_energy():
        flash("No tienes permiso para ver esta información.", "danger")
        return redirect(url_for("dashboard.index"))

    try:
        response = requests.get(
            f"{config.API_URL}/energia/registros/{id}",
            headers=auth_headers()
        )

        if response.status_code == 200:
            registro = response.json()
            return render_template(
                "energia_detalle.html",
                registro=registro,
                is_admin=is_current_user_admin()
            )

        error_msg = get_backend_error(response, "Registro de energía no encontrado")
        flash(f"❌ {error_msg}", "danger")
        return redirect(url_for("energia.listar_energia"))

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("energia.listar_energia"))


# ================== ANULAR REGISTRO ==================

@energia_bp.route("/energia/<int:id>/anular", methods=["POST"])
def anular_energia(id):
    if not require_login():
        return redirect(url_for("auth.login"))

    if not user_can_access_energy():
        flash("No tienes permiso para anular registros de energía.", "danger")
        return redirect(url_for("dashboard.index"))

    data = {
        "observaciones": request.form.get(
            "observaciones",
            "Registro anulado desde frontend"
        )
    }

    try:
        response = requests.patch(
            f"{config.API_URL}/energia/{id}/anular",
            headers=auth_headers(),
            json=data
        )

        if response.status_code == 200:
            flash("✅ Registro de energía anulado correctamente", "success")
        else:
            error_msg = get_backend_error(response, "Error al anular registro")
            flash(f"❌ {error_msg}", "danger")

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("energia.listar_energia"))


# ================== RESUMEN DE ENERGÍA ==================

@energia_bp.route("/energia/resumen")
def resumen_energia():
    if not require_login():
        return redirect(url_for("auth.login"))

    if not user_can_access_energy():
        flash("No tienes permiso para ver el resumen de energía.", "danger")
        return redirect(url_for("dashboard.index"))

    fecha_inicio = request.args.get("fecha_inicio")
    fecha_fin = request.args.get("fecha_fin")

    # Periodo por defecto: 21 a 21
    if not fecha_inicio or not fecha_fin:
        fecha_inicio, fecha_fin = get_current_billing_period_range()

    fecha_inicio_dt = parse_date_yyyy_mm_dd(fecha_inicio)
    fecha_fin_dt = parse_date_yyyy_mm_dd(fecha_fin)

    if not fecha_inicio_dt or not fecha_fin_dt:
        flash("Rango de fechas inválido.", "warning")
        return redirect(url_for("energia.listar_energia"))

    if fecha_inicio_dt > fecha_fin_dt:
        flash("La fecha de inicio no puede ser mayor que la fecha fin.", "warning")
        return redirect(url_for("energia.listar_energia"))

    try:
        # Resumen con datos reales registrados.
        # No se usa proyección.
        response = requests.get(
            f"{config.API_URL}/energia/registros",
            headers=auth_headers(),
            params={
                "fecha_inicio": fecha_inicio,
                "fecha_fin": fecha_fin,
                "estado": "CERRADO"
            }
        )

        if response.status_code != 200:
            error_msg = get_backend_error(response, "Error al obtener registros de energía")
            flash(f"❌ {error_msg}", "danger")
            return redirect(url_for("energia.listar_energia"))

        registros = response.json()

        if not isinstance(registros, list):
            registros = []

        registros_cerrados = [
            r for r in registros
            if normalize_estado(r.get("estado")) in ["CERRADO", "CERRADA"]
        ]

        dias_periodo = (fecha_fin_dt - fecha_inicio_dt).days + 1

        # Días normales de operación: miércoles a domingo
        dias_operacion_esperados_lista = [
            d for d in daterange(fecha_inicio_dt, fecha_fin_dt)
            if is_operational_weekday(d)
        ]

        dias_operacion_esperados = len(dias_operacion_esperados_lista)
        fechas_operacion_esperadas_set = set(dias_operacion_esperados_lista)

        fechas_registradas = set()

        for r in registros_cerrados:
            fecha_registro = parse_date_yyyy_mm_dd(r.get("fecha"))
            if fecha_registro:
                fechas_registradas.add(fecha_registro)

        dias_con_registro = len(fechas_registradas)

        dias_operacion_registrados = len([
            f for f in fechas_registradas
            if f in fechas_operacion_esperadas_set
        ])

        # Lunes o martes con registro real.
        # Sirve para lunes festivos u operaciones especiales.
        dias_operacion_adicionales = len([
            f for f in fechas_registradas
            if f not in fechas_operacion_esperadas_set
        ])

        dias_operacion_sin_registro = max(
            dias_operacion_esperados - dias_operacion_registrados,
            0
        )

        cobertura_operativa = 0
        if dias_operacion_esperados > 0:
            cobertura_operativa = (
                dias_operacion_registrados / dias_operacion_esperados
            ) * 100

        # Totales reales del periodo
        consumo_total_kwh = sum(safe_float(r.get("consumo_total_kwh")) for r in registros_cerrados)
        consumo_gravity_kwh = sum(safe_float(r.get("consumo_gravity_kwh")) for r in registros_cerrados)
        consumo_zona_cero_kwh = sum(safe_float(r.get("consumo_zona_cero_kwh")) for r in registros_cerrados)

        # Diferencia técnica.
        # No se muestra como KPI principal, solo en distribución.
        consumo_diferencia_kwh = consumo_total_kwh - consumo_gravity_kwh - consumo_zona_cero_kwh
        if consumo_diferencia_kwh < 0:
            consumo_diferencia_kwh = 0

        costo_total = sum(safe_float(r.get("costo_total")) for r in registros_cerrados)
        costo_gravity = sum(safe_float(r.get("costo_gravity")) for r in registros_cerrados)
        costo_zona_cero = sum(safe_float(r.get("costo_zona_cero")) for r in registros_cerrados)

        costo_diferencia = costo_total - costo_gravity - costo_zona_cero
        if costo_diferencia < 0:
            costo_diferencia = 0

        promedio_dia_registrado_kwh = 0
        if dias_con_registro > 0:
            promedio_dia_registrado_kwh = consumo_total_kwh / dias_con_registro

        promedio_dia_operativo_kwh = 0
        if dias_operacion_registrados > 0:
            promedio_dia_operativo_kwh = consumo_total_kwh / dias_operacion_registrados

        resumen = {
            "consumo_total_kwh": consumo_total_kwh,
            "consumo_gravity_kwh": consumo_gravity_kwh,
            "consumo_zona_cero_kwh": consumo_zona_cero_kwh,
            "consumo_diferencia_kwh": consumo_diferencia_kwh,

            "costo_total": costo_total,
            "costo_gravity": costo_gravity,
            "costo_zona_cero": costo_zona_cero,
            "costo_diferencia": costo_diferencia,

            "dias_periodo": dias_periodo,
            "dias_con_registro": dias_con_registro,
            "dias_operacion_esperados": dias_operacion_esperados,
            "dias_operacion_registrados": dias_operacion_registrados,
            "dias_operacion_sin_registro": dias_operacion_sin_registro,
            "dias_operacion_adicionales": dias_operacion_adicionales,
            "cobertura_operativa": cobertura_operativa,

            "promedio_dia_registrado_kwh": promedio_dia_registrado_kwh,
            "promedio_dia_operativo_kwh": promedio_dia_operativo_kwh,
        }

        return render_template(
            "energia_resumen.html",
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
            resumen=resumen,
            is_admin=is_current_user_admin()
        )

    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("energia.listar_energia"))