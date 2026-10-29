import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { q } from "./db.js";

const COOKIE = "sdp_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
let dummyHash;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.VERCEL) throw new Error("SESSION_SECRET is not set");
  return s || "dev-only-secret";
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payload) => b64(crypto.createHmac("sha256", secret()).update(payload).digest());

export const nameKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
export const validPin = (pin) => /^\d{4}$/.test(String(pin || ""));
export const hashPin = (pin) => bcrypt.hash(String(pin), 10);

export function sessionCookie(userId) {
  const payload = b64(JSON.stringify({ u: userId, exp: Date.now() + SESSION_DAYS * 864e5 }));
  const secure = process.env.VERCEL || process.env.COOKIE_SECURE ? "; Secure" : "";
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function readCookie(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

export async function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!data.u || data.exp < Date.now()) return null;
  const rows = await q("SELECT id, name, is_admin FROM users WHERE id = $1", [data.u]);
  return rows[0] || null;
}

export async function login(name, pin) {
  const key = nameKey(name);
  if (!key || !validPin(pin)) return { error: "Enter your name and 4-digit PIN." };
  const [att] = await q("SELECT fails, locked_until FROM login_attempts WHERE name_key = $1", [key]);
  if (att && Number(att.locked_until) > Date.now()) {
    const mins = Math.ceil((Number(att.locked_until) - Date.now()) / 60000);
    return { error: `Too many wrong tries. Try again in ${mins} min.`, status: 429 };
  }
  const [user] = await q("SELECT id, name, pin_hash, is_admin FROM users WHERE name_key = $1", [key]);
  dummyHash ||= bcrypt.hashSync("0000", 10);
  const ok = user ? await bcrypt.compare(String(pin), user.pin_hash) : (await bcrypt.compare(String(pin), dummyHash), false);
  if (!ok) {
    const fails = (att ? att.fails : 0) + 1;
    const lockedUntil = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
    await q(`INSERT INTO login_attempts (name_key, fails, locked_until) VALUES ($1, $2, $3)
             ON CONFLICT (name_key) DO UPDATE SET fails = $2, locked_until = $3`, [key, fails >= MAX_FAILS ? 0 : fails, lockedUntil]);
    return { error: "Wrong name or PIN.", status: 401 };
  }
  await q("DELETE FROM login_attempts WHERE name_key = $1", [key]);
  return { user: { id: user.id, name: user.name, is_admin: user.is_admin } };
}

export async function ensureAdmin() {
  const [{ n }] = await q("SELECT COUNT(*)::int AS n FROM users");
  const name = process.env.ADMIN_NAME, pin = process.env.ADMIN_PIN;
  if (n > 0 || !name || !validPin(pin)) return;
  await q("INSERT INTO users (name, name_key, pin_hash, is_admin, created_at) VALUES ($1, $2, $3, TRUE, $4) ON CONFLICT (name_key) DO NOTHING",
    [name.trim(), nameKey(name), await hashPin(pin), Date.now()]);
}
