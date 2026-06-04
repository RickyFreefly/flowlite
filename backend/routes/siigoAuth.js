import axios from "axios";

export async function getSiigoToken() {
  try {
    if (!process.env.SIIGO_USER || !process.env.SIIGO_KEY) {
      throw new Error("Faltan credenciales SIIGO_USER o SIIGO_KEY en .env");
    }

    const response = await axios.post(
      "https://api.siigo.com/auth",
      {
        username: process.env.SIIGO_USER,
        access_key: process.env.SIIGO_KEY,
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error(
      "Error obteniendo token de Siigo:",
      error.response?.data || error.message
    );
    throw new Error("No se pudo obtener token de Siigo");
  }
}
