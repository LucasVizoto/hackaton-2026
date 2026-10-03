import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "br.cocapec.recebimento.demo",
  appName: "Recebimento Cocapec",
  webDir: "dist/browser",
  server: { androidScheme: "http", cleartext: true },
};
export default config;
