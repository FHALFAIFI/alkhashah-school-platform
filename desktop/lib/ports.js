// @ts-check
"use strict";
/**
 * Loopback port selection. A previously used port is preferred (the browser origin —
 * cookies, service worker, the offline IndexedDB queue — is keyed by host:port, so a
 * stable port keeps them), but any conflict silently falls back to a free port chosen
 * by the OS. Nothing ever binds to anything but 127.0.0.1.
 */
const net = require("node:net");

const HOST = "127.0.0.1";

/** @param {number} port */
function isPortFree(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return resolve(false);
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen({ host: HOST, port, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** @returns {Promise<number>} */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * @param {number | undefined} preferred
 * @param {Set<number>} [avoid]
 */
async function pickPort(preferred, avoid = new Set()) {
  if (preferred && !avoid.has(preferred) && (await isPortFree(preferred))) return preferred;
  for (let i = 0; i < 20; i++) {
    const p = await ephemeralPort();
    if (!avoid.has(p)) return p;
  }
  throw new Error("no free loopback port");
}

module.exports = { HOST, isPortFree, pickPort };
