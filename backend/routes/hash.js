import bcrypt from "bcrypt";

async function main() {
  const nueva = "Gravity2026";
  const hash = await bcrypt.hash(nueva, 10);
  console.log("HASH_GENERADO:", hash);
}

main().catch(console.error);


