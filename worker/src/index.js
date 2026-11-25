// VISHARE Worker: serves the static pages in /public and the JSON API under /api.
// No npm dependencies: Supabase is reached through its REST API, and R2 upload
// links are presigned here with AWS SigV4 (Web Crypto).

import { presignR2 } from "./sigv4.js";

const MAX_BYTES = 2 * 1024 ** 3; // 2 GB per video
const MOMENTS = ["צילומי חוץ", "חופה", "ריקודים", "סלואו", "ברכות"];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, env, url);
      // Guest link: /e/<slug>  -> guest page (slug is read client-side)
      if (/^\/e\/[a-z0-9-]+\/?$/.test(url.pathname)) {
        // Fetch "/guest", not "/guest.html": static assets answer "*.html" with a redirect,
        // which would change the address in the guest's browser and lose the event slug.
        const page = await env.ASSETS.fetch(new Request(new URL("/guest", url), { headers: req.headers }));
        return new Response(page.body, { status: page.status, headers: page.headers });
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "שגיאה בשרת. נסו שוב בעוד רגע." }, 500);
    }
  },
};

/* ---------------- API ---------------- */

async function api(req, env, url) {
  const p = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  let r;

  // Public event info for the guest page
  if (m === "GET" && (r = p.match(/^\/api\/events\/([a-z0-9-]+)$/))) {
    const ev = await eventBySlug(env, r[1]);
    return json(publicEvent(ev));
  }

  // Guest joins: name + phone -> private token stored on the guest's phone
  if (m === "POST" && (r = p.match(/^\/api\/events\/([a-z0-9-]+)\/join$/))) {
    const ev = await eventBySlug(env, r[1]);
    const body = await readJson(req);
    const name = String(body.name || "").trim().slice(0, 80);
    const phone = normPhone(body.phone);
    if (!name) throw new HttpError(400, "חסר שם");
    if (!phone) throw new HttpError(400, "מספר הטלפון לא תקין");
    const token = randomToken();
    const [g] = await db(env, "POST", "guests", {
      body: { event_id: ev.id, name, phone, token_hash: await sha256(token) },
    });
    return json({ token, guest: { id: g.id, name: g.name } });
  }

  // ---- Couple (private link: /couple#<token>) ----
  if (p.startsWith("/api/couple")) {
    const ev = await eventFromCoupleAuth(req, env);

    if (m === "GET" && p === "/api/couple") {
      const rows = await db(env, "GET",
        `videos?event_id=eq.${ev.id}&status=eq.uploaded&select=id,kind,moment,created_at,size_bytes,r2_key,guest_id,guests(name)&order=created_at.asc`);
      const videos = await Promise.all(rows.map(async (v, i) => {
        const ext = v.r2_key.split(".").pop();
        return {
          id: v.id, kind: v.kind, moment: v.moment, createdAt: v.created_at, guest: v.guests?.name || "אורח",
          url: await presignR2(env, "GET", v.r2_key, 6 * 3600),
          downloadUrl: await presignR2(env, "GET", v.r2_key, 6 * 3600,
            { "response-content-disposition": `attachment; filename="${ev.slug}-${String(i + 1).padStart(3, "0")}.${ext}"` }),
        };
      }));
      const edits = await db(env, "GET", `edits?event_id=eq.${ev.id}&status=in.(approved,sent)&select=id,moment,r2_key,status&order=created_at.asc`);
      const editsOut = await Promise.all(edits.filter((e) => e.r2_key).map(async (e) => ({
        id: e.id, moment: e.moment,
        url: await presignR2(env, "GET", e.r2_key, 6 * 3600),
        downloadUrl: await presignR2(env, "GET", e.r2_key, 6 * 3600, { "response-content-disposition": `attachment; filename="${ev.slug}-${e.id.slice(0, 6)}.mp4"` }),
      })));
      const inv = await db(env, "GET", `invitees?event_id=eq.${ev.id}&select=id`);
      return json({
        event: { ...publicEvent(ev), package: ev.package, invitedCount: ev.invited_count },
        guestLink: `${url.origin}/e/${ev.slug}`,
        stats: { videos: videos.length, guests: new Set(rows.map((r) => r.guest_id)).size, sizeBytes: rows.reduce((a, r) => a + (r.size_bytes || 0), 0) },
        videos, edits: editsOut, inviteeCount: inv.length,
      });
    }

    // Guest list from Excel/CSV (replaces the previous list)
    if (m === "PUT" && p === "/api/couple/invitees") {
      const b = await readJson(req);
      const seen = new Set();
      const list = (Array.isArray(b.invitees) ? b.invitees : []).slice(0, 3000).map((x) => ({
        event_id: ev.id, name: String(x.name || "").trim().slice(0, 80) || null, phone: normPhone(x.phone),
      })).filter((x) => x.phone && !seen.has(x.phone) && seen.add(x.phone));
      await db(env, "DELETE", `invitees?event_id=eq.${ev.id}`);
      if (list.length) await db(env, "POST", "invitees", { body: list });
      return json({ saved: list.length });
    }
    if (m === "GET" && p === "/api/couple/invitees") {
      const rows = await db(env, "GET", `invitees?event_id=eq.${ev.id}&select=name,phone,status,sent_at&order=created_at.asc`);
      return json({ invitees: rows });
    }
  }

  // Everything below needs a guest token
  if (p.startsWith("/api/me")) {
    const guest = await guestFromAuth(req, env);
    const ev = await eventById(env, guest.event_id);

    if (m === "GET" && p === "/api/me") {
      return json({ guest: { id: guest.id, name: guest.name }, event: publicEvent(ev) });
    }

    // Ask for an upload link
    if (m === "POST" && p === "/api/me/uploads") {
      if (!isOpen(ev)) throw new HttpError(403, "ההעלאה לאירוע הזה נסגרה");
      const b = await readJson(req);
      const type = String(b.contentType || "");
      const size = Number(b.size || 0);
      if (!type.startsWith("video/")) throw new HttpError(400, "אפשר להעלות רק סרטונים");
      if (!size || size > MAX_BYTES) throw new HttpError(400, "הסרטון גדול מ־2GB");
      const kind = b.kind === "greeting" ? "greeting" : "clip";
      const moment = kind === "greeting" ? "ברכות" : (MOMENTS.includes(b.moment) ? b.moment : null);
      const ext = extFor(type, b.fileName);
      const key = `events/${ev.slug}/${guest.id}/${Date.now()}-${randomToken(6)}.${ext}`;
      const [v] = await db(env, "POST", "videos", {
        body: {
          event_id: ev.id, guest_id: guest.id, kind, moment, r2_key: key,
          file_name: String(b.fileName || "").slice(0, 200), content_type: type, size_bytes: size,
        },
      });
      const uploadUrl = await presignR2(env, "PUT", key, 3600);
      return json({ videoId: v.id, uploadUrl });
    }

    // Confirm an upload finished
    if (m === "POST" && (r = p.match(/^\/api\/me\/uploads\/([0-9a-f-]{36})\/complete$/))) {
      const v = await ownVideo(env, guest, r[1]);
      const head = await env.VIDEOS.head(v.r2_key);
      if (!head) throw new HttpError(409, "הסרטון לא הגיע. נסו להעלות שוב");
      await db(env, "PATCH", `videos?id=eq.${v.id}`, {
        body: { status: "uploaded", uploaded_at: new Date().toISOString(), size_bytes: head.size },
      });
      return json({ ok: true });
    }

    // My videos
    if (m === "GET" && p === "/api/me/videos") {
      const rows = await db(env, "GET",
        `videos?guest_id=eq.${guest.id}&status=eq.uploaded&select=id,kind,moment,created_at,r2_key&order=created_at.desc`);
      const out = await Promise.all(rows.map(async (v) => ({
        id: v.id, kind: v.kind, moment: v.moment, createdAt: v.created_at,
        url: await presignR2(env, "GET", v.r2_key, 3600),
      })));
      return json({ videos: out });
    }

    // Delete one of my videos (removes the file too)
    if (m === "DELETE" && (r = p.match(/^\/api\/me\/videos\/([0-9a-f-]{36})$/))) {
      const v = await ownVideo(env, guest, r[1]);
      await env.VIDEOS.delete(v.r2_key);
      await db(env, "PATCH", `videos?id=eq.${v.id}`, {
        body: { status: "deleted", deleted_at: new Date().toISOString() },
      });
      return json({ ok: true });
    }
  }

  // ---- Admin (LOCO) ----
  if (p.startsWith("/api/admin/")) {
    requireAdmin(req, env);

    if (m === "GET" && p === "/api/admin/events") {
      const evs = await db(env, "GET", "events?select=*&order=event_date.desc");
      const counts = await db(env, "GET", "videos?status=eq.uploaded&select=event_id,guest_id");
      return json({
        events: evs.map(({ couple_token_hash, ...e }) => {
          const vs = counts.filter((c) => c.event_id === e.id);
          return { ...e, videos: vs.length, guests: new Set(vs.map((c) => c.guest_id)).size };
        }),
      });
    }

    if (m === "POST" && p === "/api/admin/events") {
      const b = await readJson(req);
      const slug = String(b.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!slug || !b.couple_names || !b.event_date) throw new HttpError(400, "חסרים slug, שמות או תאריך");
      const closes = b.upload_closes_at || closeTimeFor(b.event_date);
      const coupleToken = randomToken();
      const [ev] = await db(env, "POST", "events", {
        body: {
          slug, couple_names: b.couple_names, event_type: b.event_type || "חתונה",
          event_date: b.event_date, venue: b.venue || null, package: b.package || "פרימיום",
          invited_count: Number(b.invited_count || 0), upload_closes_at: closes,
          couple_token_hash: await sha256(coupleToken),
        },
      });
      return json({
        event: ev,
        guestLink: `${url.origin}/e/${slug}`,
        coupleLink: `${url.origin}/couple#${coupleToken}`,
      });
    }

    // All uploaded videos of an event, with download links (for editing)
    if (m === "GET" && (r = p.match(/^\/api\/admin\/events\/([a-z0-9-]+)\/videos$/))) {
      const ev = await eventBySlug(env, r[1]);
      const rows = await db(env, "GET",
        `videos?event_id=eq.${ev.id}&status=eq.uploaded&select=id,kind,moment,created_at,size_bytes,r2_key,guests(name,phone)&order=created_at.asc`);
      const out = await Promise.all(rows.map(async (v, i) => {
        const ext = v.r2_key.split(".").pop();
        const name = `${ev.slug}-${String(i + 1).padStart(3, "0")}-${v.kind === "greeting" ? "greeting" : "clip"}.${ext}`;
        return {
          id: v.id, kind: v.kind, moment: v.moment, createdAt: v.created_at, size: v.size_bytes, guest: v.guests,
          url: await presignR2(env, "GET", v.r2_key, 6 * 3600),
          downloadUrl: await presignR2(env, "GET", v.r2_key, 6 * 3600,
            { "response-content-disposition": `attachment; filename="${name}"` }),
          fileName: name,
        };
      }));
      return json({ event: { ...publicEvent(ev), package: ev.package, invitedCount: ev.invited_count, status: ev.status }, videos: out });
    }

    // Update event details (closing time, names, venue, status...)
    if (m === "PATCH" && (r = p.match(/^\/api\/admin\/events\/([a-z0-9-]+)$/))) {
      const ev = await eventBySlug(env, r[1]);
      const b = await readJson(req);
      const allowed = ["couple_names", "event_type", "event_date", "venue", "package", "invited_count", "upload_closes_at", "status"];
      const patch = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
      if (!Object.keys(patch).length) throw new HttpError(400, "אין מה לעדכן");
      const [up] = await db(env, "PATCH", `events?id=eq.${ev.id}`, { body: patch });
      const { couple_token_hash, ...rest } = up;
      return json({ event: rest });
    }

    // New private link for the couple (the old one stops working)
    if (m === "POST" && (r = p.match(/^\/api\/admin\/events\/([a-z0-9-]+)\/couple-link$/))) {
      const ev = await eventBySlug(env, r[1]);
      const coupleToken = randomToken();
      await db(env, "PATCH", `events?id=eq.${ev.id}`, { body: { couple_token_hash: await sha256(coupleToken) } });
      return json({ coupleLink: `${url.origin}/couple#${coupleToken}` });
    }

    // System check: Supabase + presigned upload to R2, server-side (no CORS involved)
    if (m === "GET" && p === "/api/admin/selftest") {
      const out = { supabase: null, r2Put: null, r2Head: null, cors: null };
      try { await db(env, "GET", "events?select=id&limit=1"); out.supabase = "ok"; } catch (e) { out.supabase = String(e.message).slice(0, 300); }
      const key = `selftest/${Date.now()}.txt`;
      try {
        const u = await presignR2(env, "PUT", key, 300);
        const res = await fetch(u, { method: "PUT", body: "vishare selftest", headers: { "content-type": "text/plain" } });
        out.r2Put = res.ok ? "ok" : `${res.status}: ${(await res.text()).slice(0, 400)}`;
        const h = await env.VIDEOS.head(key);
        out.r2Head = h ? "ok" : "missing";
        // Preflight as a browser on vishare.co.il would send it
        const pre = await fetch(u, { method: "OPTIONS", headers: {
          origin: url.origin, "access-control-request-method": "PUT", "access-control-request-headers": "content-type" } });
        out.cors = pre.headers.get("access-control-allow-origin") ? "ok" : `missing (status ${pre.status})`;
        await env.VIDEOS.delete(key);
      } catch (e) { out.r2Put = out.r2Put || String(e.message).slice(0, 300); }
      return json(out);
    }

    // Remove a video (e.g. inappropriate content)
    if (m === "DELETE" && (r = p.match(/^\/api\/admin\/videos\/([0-9a-f-]{36})$/))) {
      const [v] = await db(env, "GET", `videos?id=eq.${r[1]}&select=*`);
      if (!v || v.status === "deleted") throw new HttpError(404, "הסרטון לא נמצא");
      await env.VIDEOS.delete(v.r2_key);
      await db(env, "PATCH", `videos?id=eq.${v.id}`, { body: { status: "deleted", deleted_at: new Date().toISOString() } });
      return json({ ok: true });
    }
  }

  throw new HttpError(404, "לא נמצא");
}

/* ---------------- helpers ---------------- */

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readJson(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "בקשה לא תקינה"); }
}

async function db(env, method, path, { body } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      // New-style secret keys (sb_secret_…) go only in `apikey`; legacy service_role JWTs also as Bearer.
      ...(String(env.SUPABASE_SERVICE_KEY).startsWith("sb_") ? {} : { authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }),
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 409) throw new HttpError(409, "כבר קיים");
    throw new Error(`Supabase ${res.status}: ${t}`);
  }
  return res.status === 204 ? [] : res.json();
}

async function eventBySlug(env, slug) {
  const [ev] = await db(env, "GET", `events?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!ev) throw new HttpError(404, "האירוע לא נמצא. בדקו את הלינק");
  return ev;
}
async function eventById(env, id) {
  const [ev] = await db(env, "GET", `events?id=eq.${id}&select=*`);
  if (!ev) throw new HttpError(404, "האירוע לא נמצא");
  return ev;
}

function publicEvent(ev) {
  return {
    slug: ev.slug, coupleNames: ev.couple_names, eventType: ev.event_type,
    eventDate: ev.event_date, venue: ev.venue, uploadClosesAt: ev.upload_closes_at, open: isOpen(ev),
  };
}
function isOpen(ev) { return new Date(ev.upload_closes_at).getTime() > Date.now(); }

async function eventFromCoupleAuth(req, env) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!tok) throw new HttpError(401, "הלינק לא תקין. בקשו מ־LOCO לינק חדש");
  const [ev] = await db(env, "GET", `events?couple_token_hash=eq.${await sha256(tok)}&select=*`);
  if (!ev) throw new HttpError(401, "הלינק לא תקין או שהוחלף. בקשו מ־LOCO לינק חדש");
  return ev;
}
async function guestFromAuth(req, env) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) throw new HttpError(401, "צריך להיכנס לאירוע מחדש");
  const [g] = await db(env, "GET", `guests?token_hash=eq.${await sha256(tok)}&select=*`);
  if (!g) throw new HttpError(401, "צריך להיכנס לאירוע מחדש");
  return g;
}
async function ownVideo(env, guest, id) {
  const [v] = await db(env, "GET", `videos?id=eq.${id}&guest_id=eq.${guest.id}&select=*`);
  if (!v || v.status === "deleted") throw new HttpError(404, "הסרטון לא נמצא");
  return v;
}
function requireAdmin(req, env) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const want = String(env.ADMIN_TOKEN || "").trim(); // tolerate a pasted trailing space/newline
  if (!want || tok !== want) throw new HttpError(401, "אין הרשאה");
}

function normPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  return /^0\d{8,9}$/.test(d) ? d : null;
}
function extFor(type, name) {
  const fromName = String(name || "").split(".").pop().toLowerCase();
  if (/^(mp4|mov|m4v|webm|3gp|avi|mkv)$/.test(fromName)) return fromName;
  return type.includes("quicktime") ? "mov" : type.includes("webm") ? "webm" : "mp4";
}
// Default: uploads close two days after the event at 20:00 Israel time (18:00 UTC in winter)
function closeTimeFor(dateStr) {
  const d = new Date(`${dateStr}T18:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString();
}
function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
