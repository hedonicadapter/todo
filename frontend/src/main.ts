import "./style.css";
import { isAuthed, onAuthChange } from "./pb";
import { store } from "./store";
import { renderApp, renderLogin } from "./ui";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

const root = document.getElementById("app")!;
let teardown: (() => void) | null = null;
let authed: boolean | null = null;

async function boot(): Promise<void> {
  const now = isAuthed();
  if (now === authed) return; // token refresh etc.
  authed = now;
  teardown?.();
  teardown = null;
  await store.stop();
  if (!now) {
    renderLogin(root);
    return;
  }
  teardown = renderApp(root, store);
  await store.start().catch(() => {});
}

onAuthChange(() => void boot());
void boot();
