/** Service worker registration (vite-plugin-pwa). After the first visit the app works offline. */
import { registerSW } from "virtual:pwa-register";
import { toast } from "./dom";

export function registerPwa(): void {
  if (!("serviceWorker" in navigator)) return;
  try {
    registerSW({
      immediate: true,
      onOfflineReady() { toast("Ready to work offline", 4000); },
      onRegisterError(e) { console.warn("Service worker registration failed", e); },
    });
  } catch (e) {
    console.warn(e);
  }
}
