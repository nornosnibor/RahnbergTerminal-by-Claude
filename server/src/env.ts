import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load `.env` from the repo root (then server/) so keys like UW_API_KEY can live in a
// file instead of the shell. Real environment variables always win.
const here = dirname(fileURLToPath(import.meta.url));
for (const file of [join(here, "..", "..", ".env"), join(here, "..", ".env")]) {
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (err) {
      console.warn(`[env] could not load ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}
