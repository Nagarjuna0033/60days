import fs from "node:fs";
import { q } from "./db.js";

const GRAPHQL = "https://leetcode.com/graphql";
const START = Date.UTC(2026, 9, 29, 0, 30);
const DAYMS = 864e5;
const POLL_MS = 10 * 60 * 1000;
const SPACING_MS = 2000;
const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Referer": "https://leetcode.com/",
  "Origin": "https://leetcode.com",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

export const validLeetcodeName = (u) => /^[A-Za-z0-9_.-]{1,40}$/.test(String(u || ""));
export const currentDay = () => Math.min(60, Math.max(1, Math.floor((Date.now() - START) / DAYMS) + 1));
const unlockAt = (day) => START + (day - 1) * DAYMS;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let slugs;
function slugMap() {
  if (!slugs) {
    const bank = JSON.parse(fs.readFileSync(new URL("../public/bank.json", import.meta.url), "utf8"));
    slugs = new Map();
    for (const d of bank) d.problems.forEach((p, idx) => {
      const slug = (p.url.match(/\/problems\/([^/]+)/) || [])[1];
      if (slug) (slugs.get(slug) || slugs.set(slug, []).get(slug)).push({ day: d.day, idx });
    });
  }
  return slugs;
}

async function gql(query, variables) {
  const res = await fetch(GRAPHQL, { method: "POST", headers: HEADERS, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error(`LeetCode HTTP ${res.status}`), { status: res.status });
  const json = await res.json();
  if (!json.data) throw new Error("LeetCode returned no data");
  return json.data;
}

export async function findLeetcodeUser(username) {
  const data = await gql("query u($u: String!) { matchedUser(username: $u) { username } }", { u: username });
  return data.matchedUser ? data.matchedUser.username : null;
}

async function recentAccepted(username) {
  const data = await gql("query r($u: String!, $l: Int!) { recentAcSubmissionList(username: $u, limit: $l) { titleSlug timestamp } }", { u: username, l: 20 });
  return data.recentAcSubmissionList || [];
}

const CELL_COLUMNS = new Set(["days", "auto"]);
export async function setCell(column, userId, day, idx, value) {
  if (!CELL_COLUMNS.has(column)) throw new Error("bad column");
  const cell = `jsonb_set(COALESCE(solves.${column} -> $2::text, '[false,false,false]'::jsonb), ARRAY[$3::text], to_jsonb($4::boolean))`;
  await q(`INSERT INTO solves (user_id, ${column}) VALUES ($1, jsonb_build_object($2::text, jsonb_set('[false,false,false]'::jsonb, ARRAY[$3::text], to_jsonb($4::boolean))))
           ON CONFLICT (user_id) DO UPDATE SET ${column} = jsonb_set(solves.${column}, ARRAY[$2::text], ${cell}, true)`,
    [userId, String(day), String(idx), !!value]);
}

export async function syncUser(userId) {
  const [user] = await q("SELECT id, leetcode FROM users WHERE id = $1", [userId]);
  if (!user || !user.leetcode) return { added: 0 };
  let list;
  try {
    list = await recentAccepted(user.leetcode);
  } catch (e) {
    await q("UPDATE users SET lc_status = 'error' WHERE id = $1", [userId]);
    throw e;
  }
  const [row] = await q("SELECT auto FROM solves WHERE user_id = $1", [userId]);
  const auto = (row && row.auto) || {};
  const cur = currentDay(), map = slugMap();
  let added = 0;
  for (const s of list) {
    const ts = Number(s.timestamp) * 1000;
    for (const { day, idx } of map.get(s.titleSlug) || []) {
      if (day > cur || ts < unlockAt(day) || (auto[day] || [])[idx]) continue;
      await setCell("auto", userId, day, idx, true);
      await setCell("days", userId, day, idx, true);
      (auto[day] ||= [false, false, false])[idx] = true;
      added++;
    }
  }
  await q("UPDATE users SET lc_last_sync = $1, lc_status = 'ok' WHERE id = $2", [Date.now(), userId]);
  return { added };
}

let running = false, fails = 0, resumeAt = 0;
async function pollAll() {
  if (running || Date.now() < resumeAt || Date.now() < START) return;
  running = true;
  try {
    const users = await q("SELECT id FROM users WHERE leetcode IS NOT NULL ORDER BY id");
    for (const u of users) {
      try {
        await syncUser(u.id);
        fails = 0;
      } catch (e) {
        fails++;
        resumeAt = Date.now() + Math.min(60 * 60 * 1000, POLL_MS * 2 ** fails);
        console.warn(`LeetCode sync paused after error: ${e.message}`);
        break;
      }
      await sleep(SPACING_MS);
    }
  } catch (e) {
    console.warn(`LeetCode poll failed: ${e.message}`);
  } finally {
    running = false;
  }
}

export function startLeetcodePoller() {
  if (process.env.LEETCODE_POLL === "off") return;
  setTimeout(pollAll, 30 * 1000);
  setInterval(pollAll, POLL_MS);
  console.log("LeetCode auto-tick poller started (every 10 min)");
}
