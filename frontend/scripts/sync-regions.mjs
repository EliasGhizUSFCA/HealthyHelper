// Copy the shared region definition into the frontend so Vercel builds (root = frontend/)
// never import from outside the package. A unit test asserts the copy is identical.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "..", "shared", "regions.json");
const dst = join(root, "lib", "generated", "regions.json");
if (!existsSync(src)) {
  console.warn("[sync-regions] ../shared/regions.json not found; keeping committed copy");
  process.exit(0);
}
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log("[sync-regions] synced regions.json");
