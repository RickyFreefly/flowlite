import { mysqlConn } from "../mysqlConn.js";

export async function obtenerReservas() {
  try {
    console.log("🔵 Probando conexión MySQL...");

    const [rows] = await mysqlConn.query(`
      SELECT
        bookingpress_appointment_booking_id,
        bookingpress_customer_id,
        bookingpress_customer_name,
        bookingpress_customer_email,
        bookingpress_customer_phone,
        bookingpress_service_id,
        bookingpress_service_name,
        bookingpress_service_price,
        bookingpress_appointment_date,
        bookingpress_appointment_time,
        bookingpress_appointment_end_time,
        bookingpress_appointment_status
      FROM ELp_bookingpress_appointment_bookings
      ORDER BY bookingpress_appointment_date DESC,
               bookingpress_appointment_time DESC
    `);

    console.log("🟢 Filas recibidas:", rows.length);
    return rows;

  } catch (err) {
    console.error("❌ ERROR MySQL:", err);
    throw new Error("No se pudieron consultar las reservas");
  }
}
