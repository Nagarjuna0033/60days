import crypto from "node:crypto";
import { q, dbUrl, dbEnvNames } from "../lib/db.js";
import { currentUser, login, sessionCookie, clearCookie, ensureAdmin, hashPin, nameKey, validPin } from "../lib/auth.js";

const TOTAL_DAYS = 60;

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

const validDay = (d) => Number.isInteger(d) && d >= 1 && d <= TOTAL_DAYS;

function cleanDays(days) {
  const out = {};
  for (const [k, v] of Object.entries(days || {})) {
    const d = Number(k);
    if (validDay(d) && Array.isArray(v)) out[d] = [0, 1, 2].map(i => v[i] === true);
  }
  return out;
}

function tokenOk(req) {
  const want = process.env.SOLUTIONS_TOKEN;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  if (path === "/api/health") return send(res, 200, { db: !!dbUrl(), envNames: dbEnvNames(), commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7), env: process.env.VERCEL_ENV || "local" });

  await ensureAdmin();

  if (path === "/api/login" && method === "POST") {
    const { name, pin } = await readBody(req);
    const r = await login(name, pin);
    if (r.error) return send(res, r.status || 400, { error: r.error });
    return send(res, 200, { user: r.user }, { "Set-Cookie": sessionCookie(r.user.id) });
  }

  if (path === "/api/signup" && method === "POST") {
    const { name, pin } = await readBody(req);
    const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!clean) return send(res, 400, { error: "Enter your name." });
    if (!validPin(pin)) return send(res, 400, { error: "PIN must be 4 digits." });
    const [exists] = await q("SELECT id FROM users WHERE name_key = $1", [nameKey(clean)]);
    if (exists) return send(res, 409, { error: "That name is taken. Log in instead, or pick another name." });
    const [row] = await q("INSERT INTO users (name, name_key, pin_hash, is_admin, created_at) VALUES ($1, $2, $3, FALSE, $4) ON CONFLICT (name_key) DO NOTHING RETURNING id",
      [clean, nameKey(clean), await hashPin(pin), Date.now()]);
    if (!row) return send(res, 409, { error: "That name is taken. Log in instead, or pick another name." });
    return send(res, 200, { user: { id: row.id, name: clean, is_admin: false } }, { "Set-Cookie": sessionCookie(row.id) });
  }

  if (path === "/api/logout" && method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": clearCookie() });

  const solMatch = path.match(/^\/api\/solutions\/(\d+)$/);
  if (solMatch && method === "PUT") {
    if (!tokenOk(req)) return send(res, 401, { error: "Bad token." });
    const day = Number(solMatch[1]);
    const body = await readBody(req);
    if (!validDay(day) || !Array.isArray(body.items) || body.items.length !== 3) return send(res, 400, { error: "Need day 1-60 and exactly 3 items." });
    const data = { day, items: body.items.map(it => ({ approach: String(it.approach || ""), time: String(it.time || ""), space: String(it.space || ""), code: String(it.code || ""), gotcha: String(it.gotcha || "") })) };
    await q("INSERT INTO solutions (day, data) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET data = $2", [day, JSON.stringify(data)]);
    return send(res, 200, { ok: true, day });
  }
  if (solMatch && method === "GET") {
    if (!tokenOk(req)) return send(res, 401, { error: "Bad token." });
    const [row] = await q("SELECT data FROM solutions WHERE day = $1", [Number(solMatch[1])]);
    return send(res, row ? 200 : 404, row ? row.data : { error: "Not found." });
  }

  const me = await currentUser(req);
  if (!me) return send(res, 401, { error: "Not logged in." });

  if (path === "/api/me" && method === "GET") return send(res, 200, { user: me });

  if (path === "/api/state" && method === "GET") {
    const [users, solves, sols, comments] = await Promise.all([
      q("SELECT id, name FROM users ORDER BY id"),
      q("SELECT user_id, days FROM solves"),
      q("SELECT day, data FROM solutions"),
      q("SELECT id, user_id, d, p, t, at FROM comments ORDER BY at"),
    ]);
    return send(res, 200, {
      me,
      users: Object.fromEntries(users.map(u => [u.id, u.name])),
      solves: Object.fromEntries(solves.map(s => [s.user_id, s.days])),
      solutions: Object.fromEntries(sols.map(s => [s.day, s.data])),
      comments,
    });
  }

  if (path === "/api/solves" && method === "PUT") {
    const { days } = await readBody(req);
    const clean = cleanDays(days);
    await q("INSERT INTO solves (user_id, days) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET days = $2", [me.id, JSON.stringify(clean)]);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/comments" && method === "POST") {
    const { d, p, t } = await readBody(req);
    const text = String(t || "").trim().slice(0, 2000);
    if (!validDay(d) || ![0, 1, 2].includes(p) || !text) return send(res, 400, { error: "Write something first." });
    const [row] = await q("INSERT INTO comments (user_id, d, p, t, at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [me.id, d, p, text, Date.now()]);
    return send(res, 200, { id: row.id });
  }

  const cDel = path.match(/^\/api\/comments\/(\d+)$/);
  if (cDel && method === "DELETE") {
    const id = Number(cDel[1]);
    if (me.is_admin) await q("DELETE FROM comments WHERE id = $1", [id]);
    else await q("DELETE FROM comments WHERE id = $1 AND user_id = $2", [id, me.id]);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/me/pin" && method === "PUT") {
    const { pin } = await readBody(req);
    if (!validPin(pin)) return send(res, 400, { error: "PIN must be 4 digits." });
    await q("UPDATE users SET pin_hash = $1 WHERE id = $2", [await hashPin(pin), me.id]);
    return send(res, 200, { ok: true });
  }

  if (path.startsWith("/api/admin/")) {
    if (!me.is_admin) return send(res, 403, { error: "Admins only." });

    if (path === "/api/admin/users" && method === "GET") {
      const rows = await q("SELECT id, name, is_admin, created_at FROM users ORDER BY id");
      return send(res, 200, { users: rows });
    }
    if (path === "/api/admin/users" && method === "POST") {
      const { name, pin } = await readBody(req);
      const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!clean) return send(res, 400, { error: "Enter a name." });
      if (!validPin(pin)) return send(res, 400, { error: "PIN must be 4 digits." });
      const [exists] = await q("SELECT id FROM users WHERE name_key = $1", [nameKey(clean)]);
      if (exists) return send(res, 409, { error: "That name is already taken." });
      await q("INSERT INTO users (name, name_key, pin_hash, is_admin, created_at) VALUES ($1, $2, $3, FALSE, $4)", [clean, nameKey(clean), await hashPin(pin), Date.now()]);
      return send(res, 200, { ok: true });
    }
    const uMatch = path.match(/^\/api\/admin\/users\/(\d+)(\/pin)?$/);
    if (uMatch && uMatch[2] && method === "PUT") {
      const { pin } = await readBody(req);
      if (!validPin(pin)) return send(res, 400, { error: "PIN must be 4 digits." });
      await q("UPDATE users SET pin_hash = $1 WHERE id = $2", [await hashPin(pin), Number(uMatch[1])]);
      const [u] = await q("SELECT name_key FROM users WHERE id = $1", [Number(uMatch[1])]);
      if (u) await q("DELETE FROM login_attempts WHERE name_key = $1", [u.name_key]);
      return send(res, 200, { ok: true });
    }
    if (uMatch && !uMatch[2] && method === "DELETE") {
      const id = Number(uMatch[1]);
      if (id === me.id) return send(res, 400, { error: "You can't remove yourself." });
      await q("DELETE FROM users WHERE id = $1", [id]);
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: "Not found." });
}

export default async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (e) {
    console.error(e);
    if (e instanceof SyntaxError) return send(res, 400, { error: "Bad JSON." });
    if (/No database connected/.test(e.message)) return send(res, 503, { error: "The site's database isn't connected yet." });
    send(res, 500, { error: "Something went wrong. Try again." });
  }
}
