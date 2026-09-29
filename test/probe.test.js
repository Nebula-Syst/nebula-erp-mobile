import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

globalThis.window = {}; // app.js solo usa window.Capacitor (ausente fuera del móvil)
const { normalizeUrl, probeServer } = await import("../www/app.js");

let server, base;
const routes = {
  "/nebula/api/v1/setup/status": [200, "application/json", '{"needs_setup":false}'],
  "/nebula/nebula.json": [200, "application/json", '{"edition":"printflow","features":["i18n-es"]}'],
  "/std/api/v1/setup/status": [200, "application/json", '{"needs_setup":false}'],
  "/std/nebula.json": [200, "text/html", "<!doctype html><title>SPA</title>"], // fallback SPA
  "/access/api/v1/setup/status": [200, "text/html", '<form action="https://x.cloudflareaccess.com/cdn-cgi/access/login">'],
  "/other/api/v1/setup/status": [404, "text/html", "Not found"],
};

before(async () => {
  server = http.createServer((req, res) => {
    const [code, type, body] = routes[req.url] || [404, "text/plain", "no"];
    res.writeHead(code, { "Content-Type": type });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("normalizeUrl acepta lo que escribe un usuario", () => {
  assert.equal(normalizeUrl("gestion.tutaller.com"), "https://gestion.tutaller.com");
  assert.equal(normalizeUrl("  GESTION.tutaller.com/admin "), "https://gestion.tutaller.com");
  assert.equal(normalizeUrl("http://192.168.1.50:13003/x"), "http://192.168.1.50:13003");
  assert.equal(normalizeUrl("hola"), null);
  assert.equal(normalizeUrl(""), null);
});

test("detecta un servidor PrintFlow", async () => {
  const r = await probeServer(`${base}/nebula`);
  assert.deepEqual(r, { kind: "filaops", edition: "printflow", features: ["i18n-es"] });
});

test("un FilaOps estándar funciona aunque no tenga nebula.json", async () => {
  const r = await probeServer(`${base}/std`);
  assert.deepEqual(r, { kind: "filaops", edition: "filaops", features: [] });
});

test("reconoce un login previo tipo Cloudflare Access", async () => {
  assert.equal((await probeServer(`${base}/access`)).kind, "protected");
});

test("otra web que no es FilaOps", async () => {
  assert.equal((await probeServer(`${base}/other`)).kind, "unknown");
});

test("servidor caído", async () => {
  assert.equal((await probeServer("http://127.0.0.1:1")).kind, "unreachable");
});
