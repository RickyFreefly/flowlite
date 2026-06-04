from flask import Blueprint, render_template, session, redirect, url_for, flash, request
import requests
import config
from datetime import datetime

# ✅ Blueprint con nombre coherente
caja_bp = Blueprint("caja", __name__)

# ================== LISTAR MOVIMIENTOS DE CAJA ==================
@caja_bp.route("/caja")
def listar_caja():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    # ✅ Restricción de acceso: solo usuario ID 6
    if session.get("idusuario") != 6:
        flash("No tienes permiso para acceder a esta sección.", "danger")
        return redirect(url_for("dashboard.index"))

    try:
        headers = {"Authorization": f"Bearer {session['token']}"}
        response = requests.get(f"{config.API_URL}/caja", headers=headers)

        if response.status_code == 200:
            movimientos = response.json()
            fecha_actual = datetime.now().strftime("%Y-%m-%d")

            # ===== Calcular totales =====
            total_ingresos = sum(float(m["valor"]) for m in movimientos if m["movimiento"] == "ENTRADA")
            total_egresos = sum(float(m["valor"]) for m in movimientos if m["movimiento"] == "SALIDA")
            total_caja = total_ingresos - total_egresos

            return render_template(
                "caja.html",
                movimientos=movimientos,
                fecha_actual=fecha_actual,
                total_caja=total_caja,
                total_ingresos=total_ingresos,
                total_egresos=total_egresos,
            )
        else:
            flash("Error al obtener movimientos de caja", "danger")
            return redirect(url_for("dashboard.index"))
    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("dashboard.index"))


# ================== CREAR MOVIMIENTO DE CAJA ==================
@caja_bp.route("/caja/nuevo", methods=["POST"])
def crear_caja():
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    # ✅ Restringir creación solo al usuario 5
    if session.get("idusuario") != 5:
        flash("No tienes permiso para registrar movimientos de caja.", "danger")
        return redirect(url_for("dashboard.index"))

    fecha_actual = datetime.now().strftime("%Y-%m-%d")

    data = {
        "fecha": fecha_actual,
        "concepto": request.form["concepto"],
        "proveedor": request.form["proveedor"],
        "valor": request.form["valor"],
        "movimiento": request.form["movimiento"],
        "observacion": request.form.get("observacion", ""),
        "idusuario": session.get("idusuario"),
    }

    try:
        headers = {
            "Authorization": f"Bearer {session['token']}",
            "Content-Type": "application/json"
        }
        response = requests.post(f"{config.API_URL}/caja", headers=headers, json=data)

        if response.status_code in (200, 201):
            flash("✅ Movimiento de caja registrado correctamente", "success")
        else:
            flash("❌ Error al registrar movimiento", "danger")
    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")

    return redirect(url_for("caja.listar_caja"))


# ================== DETALLE MOVIMIENTO DE CAJA ==================
@caja_bp.route("/caja/<int:id>")
def detalle_caja(id):
    if "token" not in session:
        flash("Debes iniciar sesión primero", "warning")
        return redirect(url_for("auth.login"))

    # ✅ Restricción de acceso también aquí
    if session.get("idusuario") != 5:
        flash("No tienes permiso para ver esta información.", "danger")
        return redirect(url_for("dashboard.index"))

    try:
        headers = {"Authorization": f"Bearer {session['token']}"}
        response = requests.get(f"{config.API_URL}/caja/{id}", headers=headers)

        if response.status_code == 200:
            movimiento = response.json()
            return render_template("caja_detalle.html", movimiento=movimiento)
        else:
            flash("❌ Movimiento no encontrado", "danger")
            return redirect(url_for("caja.listar_caja"))
    except Exception as e:
        flash(f"Error conectando al backend: {e}", "danger")
        return redirect(url_for("caja.listar_caja"))
