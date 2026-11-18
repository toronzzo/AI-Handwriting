/**
 * The router hook shared by every Preyas OS slice. proxy.mjs calls
 * handleOsRoute once, right after the pairing/auth gate, and never needs
 * another change: later slices only add routes inside this file.
 */
import { PREYAS_CHAT_PERSONA } from "../../../packages/alive/src/persona.ts";
import { listVersions, loadPersona } from "./persona.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * handleOsRoute(ctx) -> true when it answered, false when the path is not one
 * of its routes. ctx = { req, res, url, dataDir, readJson, readBody, now }.
 */
export async function handleOsRoute(ctx) {
  const { req, res, url, dataDir } = ctx;
  // ctx.now may return a Date or a number (proxy passes Date.now()); always hand out a Date.
  const now = () => {
    const value = typeof ctx.now === "function" ? ctx.now() : Date.now();
    return value instanceof Date ? value : new Date(value);
  };

  if (url.pathname === "/v1/persona" && req.method === "GET") {
    const persona = loadPersona(dataDir, { defaultText: PREYAS_CHAT_PERSONA, now });
    sendJson(res, 200, persona);
    return true;
  }

  if (url.pathname === "/v1/persona/versions" && req.method === "GET") {
    // Revision lines only; the persona text never leaves the live file.
    sendJson(res, 200, { versions: listVersions(dataDir) });
    return true;
  }

  return false;
}
