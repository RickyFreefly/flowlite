import os

# ===============================
# CONFIGURACIÓN GENERAL DEL PROYECTO
# ===============================

# Si existe una variable de entorno API_URL (Render), la usa.
# Si no, usa el backend local (para desarrollo).
API_URL = os.getenv("API_URL", "http://localhost:3000/api")

SECRET_KEY = os.getenv("SECRET_KEY", "clave_super_secreta")
