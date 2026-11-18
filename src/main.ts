import "./ui/styles.css";
import { startApp } from "./ui/app";
import { registerPwa } from "./ui/pwa";

function boot(): void {
  try {
    startApp();
  } catch (e) {
    console.error(e);
    const m = document.getElementById("msg");
    if (m) { m.className = "msg err"; m.textContent = "Robot Lab couldn't start. Reload the page. If it keeps happening, tell your teacher."; }
  }
  registerPwa();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
