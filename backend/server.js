import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ✅ Importar rutas
import productosRoutes from "./routes/productos.js";
import clientesRoutes from "./routes/clientes.js";
import mediosRoutes from "./routes/medios_pago.js";
import reservasRoutes from "./routes/reservas.js";
import facturasRoutes from "./routes/facturas.js";
import driveRoutes from "./routes/drive.js";
import egresosRoutes from "./routes/egresos.js";
import usuariosRoutes from "./routes/usuarios.js";
import authRoutes from "./routes/auth.js";
import cierreDiaRoutes from "./routes/cierre_dia.js";
import cajaRoutes from "./routes/caja.js";
import energiaRoutes from "./routes/energia.js";
import calendarReservasRoutes from "./routes/calendarReservas.js";
import paracaidistasHorasRoutes from "./routes/paracaidistasHoras.js";
import coachRoutes from "./routes/coach.js";
import informeVuelosMesRoutes from "./routes/informe_vuelos_mes.js";

// ✅ Middleware JWT
import { authJwt } from "./routes/authJwt.js";

// ✅ Inicializar app
const app = express();

// =================== MIDDLEWARES ===================

// 🔹 Parsear JSON
app.use(express.json());

// 🔹 Configurar CORS
const allowedOrigins = [
  "http://127.0.0.1:5000",
  "http://localhost:5000",
  "http://127.0.0.1:52087",
  "http://localhost:52087",
  "http://127.0.0.1:65489",
  "http://localhost:65489",
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : []),
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

console.log("🌐 CORS habilitado para:", allowedOrigins.join(", "));

// =================== RUTAS API ===================

// ✅ Públicas
app.use("/api/auth", authRoutes);

// ✅ Protegidas
app.use("/api/productos", authJwt, productosRoutes);
app.use("/api/clientes", authJwt, clientesRoutes);
app.use("/api/medios", authJwt, mediosRoutes);
app.use("/api/reservas", authJwt, reservasRoutes);
app.use("/api/facturas", authJwt, facturasRoutes);
app.use("/api/drive", authJwt, driveRoutes);
app.use("/api/egresos", authJwt, egresosRoutes);
app.use("/api/usuarios", authJwt, usuariosRoutes);
app.use("/api/cierre-dia", authJwt, cierreDiaRoutes);
app.use("/api/caja", authJwt, cajaRoutes);
app.use("/api/energia", authJwt, energiaRoutes);
app.use("/api/calendar-reservas", authJwt, calendarReservasRoutes);
app.use("/api/paracaidistas-horas", authJwt, paracaidistasHorasRoutes);
app.use("/api/vuelos-mes", informeVuelosMesRoutes);

// Recomendado: proteger también coach si no es público
app.use("/api/coach", authJwt, coachRoutes);

// =================== RUTA DE PRUEBA ===================
app.get("/", (req, res) => {
  res.json({
    status: "🚀 API Facturación funcionando correctamente",
  });
});

// =================== SERVIDOR ===================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ API corriendo en http://localhost:${PORT}`);
});