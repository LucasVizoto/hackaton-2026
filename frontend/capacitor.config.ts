import type { CapacitorConfig } from "@capacitor/cli";
const production = process.env["COCAPEC_DEPLOY_TARGET"] === "production";
const config: CapacitorConfig = {
  appId: "br.cocapec.recebimento.demo",
  appName: "Recebimento Cocapec",
  webDir: "dist/browser",
  loggingBehavior: "none",
  server: production
    ? { androidScheme: "https", cleartext: false, appStartPath: "/login" }
    : { androidScheme: "http", cleartext: true },
};
export default config;
