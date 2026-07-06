import { config } from "dotenv";
config({ path: ".env.local" });

const { ensureSchema } = await import("../src/lib/db.ts");
await ensureSchema();
console.log("schema ready");
process.exit(0);
