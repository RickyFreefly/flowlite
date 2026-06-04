from flask import Blueprint, render_template, jsonify, flash
import requests
import config

calendar_bp = Blueprint("calendar", __name__)

@calendar_bp.route("/calendar")
def calendar_view():
    try:
        # 👇 Usamos la API_URL del config, NO localhost
        resp = requests.get(f"{config.API_URL}/calendar-reservas")

        if resp.status_code != 200:
            flash("❌ Error al obtener las reservas del calendario", "danger")
            return render_template("calendar.html", events=[])

        data = resp.json().get("data", [])

        events = []
        for reserva in data:
            events.append({
                "id": reserva["bookingpress_appointment_booking_id"],
                "title": f"{reserva['bookingpress_customer_name']} - {reserva['bookingpress_service_name']}",
                "start": f"{reserva['bookingpress_appointment_date'][:10]}T{reserva['bookingpress_appointment_time']}",
                "end": f"{reserva['bookingpress_appointment_date'][:10]}T{reserva['bookingpress_appointment_end_time']}",
                "color": "#4CAF50" if reserva["bookingpress_appointment_status"] == 1 else "#BDBDBD",
            })

        return render_template("calendar.html", events=events)

    except Exception as e:
        # Para debug rápido, dejas esto mientras tanto:
        return jsonify({"error": str(e)})
