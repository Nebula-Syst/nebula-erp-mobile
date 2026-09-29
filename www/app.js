/*
 * PrintFlow — pantalla de servidores de la app (PrintFlow es un fork modificado de FilaOps).
 *
 * La app no trae la interfaz del ERP: guarda una lista de servidores FilaOps y,
 * al elegir uno, carga SU propia web en el WebView. Así cada servidor muestra sus
 * funciones (las de PrintFlow o las de un FilaOps estándar) sin recompilar
 * la app. Esta página vive en el origen local de Capacitor (https://localhost);
 * los servidores vuelven aquí con el botón atrás o con https://localhost/?select=1.
 */

const STORAGE_KEY = "printflow.servers";
const LAST_KEY = "printflow.last";
const AUTO_OPENED_KEY = "printflow.auto-opened"; // sessionStorage: solo en arranque en frío
const TIMEOUT_MS = 8000;

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- almacenamiento

function loadServers() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveServers(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function upsertServer(server) {
  const list = loadServers().filter((s) => s.url !== server.url);
  list.unshift(server);
  saveServers(list);
}

// ---------------------------------------------------------------- red

/** Normaliza lo que escribe el usuario: "gestion.x.com/admin" → "https://gestion.x.com" */
export function normalizeUrl(input) {
  let value = (input || "").trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;
  try {
    const u = new URL(value);
    if (!u.hostname || !u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * GET que no depende de CORS: en el móvil usa el HTTP nativo de Capacitor
 * (el servidor FilaOps no permite peticiones desde https://localhost); en un
 * navegador normal (desarrollo) usa fetch.
 */
async function httpGet(url) {
  const native = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CapacitorHttp;
  if (native) {
    const res = await Promise.race([
      native.get({ url, headers: { Accept: "application/json" }, responseType: "text", connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS + 1000)),
    ]);
    return { status: res.status, url: res.url || url, text: typeof res.data === "string" ? res.data : JSON.stringify(res.data) };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    return { status: res.status, url: res.url || url, text: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Comprueba qué hay en `base`.
 * @returns {Promise<{kind: "filaops"|"protected"|"unknown"|"unreachable", edition?: string, features?: string[], detail?: string}>}
 */
export async function probeServer(base) {
  let status;
  try {
    status = await httpGet(`${base}/api/v1/setup/status`);
  } catch (e) {
    return { kind: "unreachable", detail: e?.message || String(e) };
  }
  const json = parseJson(status.text);
  const protectedByAccess = /cloudflareaccess\.com|cdn-cgi\/access/i.test(status.url + " " + status.text.slice(0, 2000));

  if (json && typeof json === "object" && "needs_setup" in json) {
    const info = { kind: "filaops", edition: "filaops", features: [] };
    try {
      const n = await httpGet(`${base}/nebula.json`);
      const nj = parseJson(n.text);
      if (nj?.edition) {
        info.edition = nj.edition;
        info.features = Array.isArray(nj.features) ? nj.features : [];
      }
    } catch {
      // servidor FilaOps estándar: sin nebula.json
    }
    return info;
  }
  if (protectedByAccess) return { kind: "protected" };
  return { kind: "unknown", detail: `HTTP ${status.status}` };
}

// ---------------------------------------------------------------- vista

function badgeFor(server) {
  if (server.kind === "protected") return ["Con acceso protegido", "warn"];
  if (server.edition === "printflow" || server.edition === "nebula") return ["PrintFlow", "ok"];
  if (server.kind === "filaops") return ["FilaOps estándar", "info"];
  return ["Sin verificar", "warn"];
}

function render() {
  const list = loadServers();
  const ul = $("#servers");
  ul.innerHTML = "";
  $("#empty").classList.toggle("hidden", list.length > 0);
  const tpl = $("#server-item");
  for (const s of list) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.querySelector(".name").textContent = s.name || new URL(s.url).hostname;
    li.querySelector(".host").textContent = s.url.replace(/^https:\/\//, "");
    const [label, tone] = badgeFor(s);
    const b = document.createElement("span");
    b.className = `badge ${tone}`;
    b.textContent = label;
    li.querySelector(".badges").append(b);
    li.querySelector(".open").addEventListener("click", () => openServer(s));
    const menu = li.querySelector(".menu");
    li.querySelector(".more").addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".menu").forEach((m) => m !== menu && m.classList.add("hidden"));
      menu.classList.toggle("hidden");
    });
    menu.addEventListener("click", async (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      menu.classList.add("hidden");
      if (act === "delete") {
        if (confirm(`¿Eliminar ${s.name || s.url} de la lista?`)) {
          saveServers(loadServers().filter((x) => x.url !== s.url));
          render();
        }
      } else if (act === "edit") {
        showForm(s);
      } else if (act === "check") {
        const r = await probeServer(s.url);
        upsertServer({ ...s, ...pickProbe(r), checkedAt: Date.now() });
        render();
        alert(describeProbe(r));
      }
    });
    ul.append(li);
  }
}

function pickProbe(r) {
  return { kind: r.kind, edition: r.edition || null, features: r.features || [] };
}

function describeProbe(r) {
  switch (r.kind) {
    case "filaops":
      return r.edition === "printflow" || r.edition === "nebula"
        ? "Servidor PrintFlow. Todas las funciones de la app disponibles."
        : "Servidor FilaOps estándar. Funciona, pero algunas funciones de PrintFlow (como el idioma o los ajustes de la app) no estarán.";
    case "protected":
      return "El servidor tiene un acceso protegido (por ejemplo Cloudflare Access). Al abrirlo te pedirá identificarte primero.";
    case "unreachable":
      return "No se ha podido conectar. Revisa la dirección y la conexión.";
    default:
      return "Responde, pero no parece un servidor PrintFlow ni FilaOps.";
  }
}

// ---------------------------------------------------------------- formulario

let editing = null;
let pendingForce = null;

function showForm(server = null) {
  editing = server;
  pendingForce = null;
  $("#form-title").textContent = server ? "Editar servidor" : "Añadir servidor";
  $("#f-url").value = server ? server.url.replace(/^https:\/\//, "") : "";
  $("#f-name").value = server?.name || "";
  setStatus("");
  $("#form-force").classList.add("hidden");
  $("#form-section").classList.remove("hidden");
  $("#list-section").classList.add("hidden");
  $("#f-url").focus();
}

function hideForm() {
  $("#form-section").classList.add("hidden");
  $("#list-section").classList.remove("hidden");
  render();
}

function setStatus(text, tone = "") {
  const el = $("#form-status");
  el.textContent = text;
  el.className = `status ${tone}`;
}

async function onSubmit(e) {
  e.preventDefault();
  const url = normalizeUrl($("#f-url").value);
  if (!url) {
    setStatus("Escribe una dirección válida, por ejemplo gestion.tuempresa.com", "error");
    return;
  }
  const name = $("#f-name").value.trim();
  $("#form-save").disabled = true;
  setStatus("Comprobando el servidor…");
  const r = await probeServer(url);
  $("#form-save").disabled = false;

  const server = { url, name, ...pickProbe(r), checkedAt: Date.now() };
  if (r.kind === "filaops" || r.kind === "protected") {
    finishSave(server);
    return;
  }
  setStatus(describeProbe(r) + (r.kind === "unknown" && r.detail ? ` (${r.detail})` : ""), "error");
  pendingForce = server;
  $("#form-force").classList.remove("hidden");
}

function finishSave(server) {
  if (editing && editing.url !== server.url) {
    saveServers(loadServers().filter((s) => s.url !== editing.url));
  }
  upsertServer(server);
  hideForm();
}

// ---------------------------------------------------------------- abrir

let openCancelled = false;

async function openServer(server) {
  openCancelled = false;
  $("#opening-name").textContent = server.name || new URL(server.url).hostname;
  $("#opening").classList.remove("hidden");
  $("#list-section").classList.add("hidden");

  // Comprobación rápida de que responde, para no dejar al usuario en una página de error del WebView
  const r = await probeServer(server.url).catch(() => ({ kind: "unreachable" }));
  if (openCancelled) return;
  if (r.kind === "unreachable") {
    $("#opening").classList.add("hidden");
    $("#list-section").classList.remove("hidden");
    if (!confirm(`No se ha podido conectar con ${server.url}.\n\n¿Intentar abrirlo igualmente?`)) return;
  } else {
    upsertServer({ ...server, ...pickProbe(r), checkedAt: Date.now() });
  }
  localStorage.setItem(LAST_KEY, server.url);
  window.location.href = `${server.url}/admin`;
}

// ---------------------------------------------------------------- arranque

function init() {
  $("#add-btn").addEventListener("click", () => showForm());
  $("#empty-add").addEventListener("click", () => showForm());
  $("#form-cancel").addEventListener("click", hideForm);
  $("#server-form").addEventListener("submit", onSubmit);
  $("#form-force").addEventListener("click", () => pendingForce && finishSave(pendingForce));
  $("#opening-cancel").addEventListener("click", () => {
    openCancelled = true;
    $("#opening").classList.add("hidden");
    $("#list-section").classList.remove("hidden");
  });
  document.addEventListener("click", () => document.querySelectorAll(".menu").forEach((m) => m.classList.add("hidden")));

  const appInfo = window.Capacitor?.Plugins?.App;
  appInfo?.getInfo?.().then((i) => ($("#version").textContent = `Versión ${i.version}`)).catch(() => {});

  render();

  // Arranque en frío: abrir el último servidor usado. Si volvemos aquí con "atrás"
  // o con ?select=1 (botón "Cambiar servidor" del ERP), se muestra la lista.
  const params = new URLSearchParams(location.search);
  const last = localStorage.getItem(LAST_KEY);
  const alreadyAuto = sessionStorage.getItem(AUTO_OPENED_KEY);
  sessionStorage.setItem(AUTO_OPENED_KEY, "1");
  if (!params.has("select") && !alreadyAuto && last) {
    const server = loadServers().find((s) => s.url === last);
    if (server) openServer(server);
  }
}

// En tests (Node) no hay DOM: solo se exportan las funciones
if (typeof document !== "undefined") init();
