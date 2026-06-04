import { google } from "googleapis";
import fs from "fs";
import { createObjectCsvWriter } from "csv-writer";

const auth = new google.auth.GoogleAuth({
  keyFile: "credenciales.json", // tu JSON de Google Cloud
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});

const drive = google.drive({ version: "v3", auth });

// Crear CSV local
export async function crearCSV(data) {
  const csvWriter = createObjectCsvWriter({
    path: "export.csv",
    header: [
      { id: "id", title: "ID" },
      { id: "nombre", title: "Nombre" },
      { id: "valor", title: "Valor" },
    ],
  });

  await csvWriter.writeRecords(data);
  console.log("✅ CSV generado");
}

// Subir CSV a Google Drive
export async function subirCSV(carpetaId) {
  const fileMetadata = {
    name: "export.csv",
    parents: [carpetaId],
  };
  const media = {
    mimeType: "text/csv",
    body: fs.createReadStream("export.csv"),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: "id, webViewLink",
  });

  return response.data;
}
