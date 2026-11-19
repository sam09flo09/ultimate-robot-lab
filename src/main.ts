import "./ui/styles.css";
import { startApp } from "./ui/app";
import { registerPwa } from "./ui/pwa";
import { applyDisplay, readDisplay, initDisplayMenu } from "./ui/display";

// Apply text size / contrast before the app builds its UI, so there is no flash.
applyDisplay(readDisplay());

function boot(): void {
  try {
    startApp();
  } catch (e) {
    console.error(e);
    const m = document.getElementById("msg");
    if (m) { m.className = "msg err"; m.textContent = "Robot Lab couldn't start. Reload the page. If it keeps happening, tell your teacher."; }
  }
  try { initDisplayMenu(); } catch (e) { console.error(e); }
  registerPwa();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
