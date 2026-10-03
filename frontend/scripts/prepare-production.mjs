import { writeFile } from "node:fs/promises";

// Modify the ignored build output only; development configuration stays local.
await writeFile(
  new URL("../dist/browser/runtime-config.json", import.meta.url),
  JSON.stringify({ nativeApiUrl: "https://cocapec.lucasvizoto.com/api/v1" }) + "\n",
);
