// Smoke test for the Worker API with an in-memory fake of Supabase REST and R2.
import worker, { purgeRaw } from "../worker/src/index.js";

const tables = { events: [], guests: [], videos: [], edits: [], invitees: [] };
const r2 = new Map();
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const table = u.pathname.split("/").pop();
  const rows = tables[table];
  const filters = [...u.searchParams].filter(([k]) => !["select", "order"].includes(k));
  const match = (r) => filters.every(([k, v]) =>
    v === "is.null" ? r[k] == null : v === "not.is.null" ? r[k] != null :
    v.startsWith("in.(") ? v.slice(4, -1).split(",").includes(String(r[k])) : String(r[k]) === v.replace(/^eq\./, ""));
  const method = init.method || "GET";
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (method === "GET") return ok(rows.filter(match).map((r) => (table === "videos" ? { ...r, guests: tables.guests.find((g) => g.id === r.guest_id) } : r)));
  if (method === "POST") {
    const body = JSON.parse(init.body);
    const made = (Array.isArray(body) ? body : [body]).map((b) => ({ id: uuid(), created_at: new Date().toISOString(), status: table === "videos" ? "pending" : table === "invitees" ? "pending" : "pre", ...b }));
    rows.push(...made); return ok(made);
  }
  if (method === "DELETE") { const gone = rows.filter(match); tables[table] = rows.filter((r) => !match(r)); return ok(gone); }
  if (method === "PATCH") { const b = JSON.parse(init.body); rows.filter(match).forEach((r) => Object.assign(r, b)); return ok(rows.filter(match)); }
};

const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", R2_ACCOUNT_ID: "acc", R2_BUCKET: "vishare-videos",
  R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK", ADMIN_TOKEN: "admin",
  VIDEOS: { head: async (k) => (r2.has(k) ? { size: r2.get(k) } : null), delete: async (k) => [].concat(k).forEach((x) => r2.delete(x)) },
  ASSETS: { fetch: async (req) => new Response("asset:" + new URL(req.url).pathname) },
};
const call = async (method, path, body, token) => {
  const res = await worker.fetch(new Request("https://vishare.co.il" + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }), env);
  return { status: res.status, data: await res.json().catch(() => null), text: res };
};
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok -", m); };

let r = await call("POST", "/api/admin/events", { slug: "dana-david", couple_names: "דנה ודוד", event_date: "2099-12-10" }, "admin");
assert(r.status === 200 && r.data.guestLink.endsWith("/e/dana-david"), "admin creates event");
assert((await call("POST", "/api/admin/events", {}, "nope")).status === 401, "admin needs token");
r = await call("GET", "/api/events/dana-david");
assert(r.data.open === true && r.data.coupleNames === "דנה ודוד", "public event info");
assert((await call("GET", "/api/events/nope")).status === 404, "unknown event 404");
assert((await call("POST", "/api/events/dana-david/join", { name: "רונית", phone: "12" })).status === 400, "bad phone rejected");
r = await call("POST", "/api/events/dana-david/join", { name: "רונית", phone: "050-123-4567" });
const tok = r.data.token; assert(tok && tables.guests[0].phone === "0501234567" && !JSON.stringify(tables.guests).includes(tok), "join stores hashed token + normalized phone");
assert((await call("GET", "/api/me")).status === 401, "me needs token");
r = await call("POST", "/api/me/uploads", { contentType: "video/quicktime", size: 1000, fileName: "IMG_1.MOV", moment: "חופה" }, tok);
assert(r.status === 200 && r.data.uploadUrl.includes("X-Amz-Signature=") && r.data.uploadUrl.startsWith("https://acc.r2.cloudflarestorage.com/vishare-videos/events/dana-david/"), "upload url presigned");
const vid = r.data.videoId, key = tables.videos[0].r2_key;
assert((await call("POST", `/api/me/uploads/${vid}/complete`, null, tok)).status === 409, "complete fails before file exists");
r2.set(key, 1000);
assert((await call("POST", `/api/me/uploads/${vid}/complete`, null, tok)).status === 200, "complete after upload");
r = await call("GET", "/api/me/videos", null, tok);
assert(r.data.videos.length === 1 && r.data.videos[0].moment === "חופה", "my videos lists it");
const other = (await call("POST", "/api/events/dana-david/join", { name: "אבי", phone: "0521111111" })).data.token;
assert((await call("DELETE", `/api/me/videos/${vid}`, null, other)).status === 404, "other guest cannot delete");
r = await call("GET", "/api/admin/events/dana-david/videos", null, "admin");
assert(r.data.videos.length === 1 && r.data.videos[0].guest.name === "רונית", "admin sees videos with guest name");
assert((await call("DELETE", `/api/me/videos/${vid}`, null, tok)).status === 200 && !r2.has(key), "owner deletes, file removed");
assert((await call("GET", "/api/me/videos", null, tok)).data.videos.length === 0, "deleted video gone");
assert((await call("POST", "/api/me/uploads", { contentType: "image/jpeg", size: 10 }, tok)).status === 400, "non-video rejected");
tables.events[0].upload_closes_at = "2000-01-01T00:00:00Z";
assert((await call("POST", "/api/me/uploads", { contentType: "video/mp4", size: 10 }, tok)).status === 403, "closed event refuses uploads");
r = await call("PATCH", "/api/admin/events/dana-david", { upload_closes_at: "2099-01-01T00:00:00Z", hacked: 1 }, "admin");
assert(r.status === 200 && r.data.event.upload_closes_at === "2099-01-01T00:00:00Z" && !("hacked" in tables.events[0]) && !r.data.event.couple_token_hash, "admin updates event (whitelisted fields only)");
const oldHash = tables.events[0].couple_token_hash;
r = await call("POST", "/api/admin/events/dana-david/couple-link", null, "admin");
assert(r.data.coupleLink.includes("/couple#") && tables.events[0].couple_token_hash !== oldHash, "admin regenerates couple link");
r = await call("POST", "/api/me/uploads", { contentType: "video/mp4", size: 10, fileName: "a.mp4" }, tok);
const v2 = r.data.videoId; r2.set(tables.videos.find((v) => v.id === v2).r2_key, 10);
await call("POST", `/api/me/uploads/${v2}/complete`, null, tok);
r = await call("GET", "/api/admin/events/dana-david/videos", null, "admin");
assert(r.data.videos[0].downloadUrl.includes("response-content-disposition=attachment") && r.data.videos[0].fileName.startsWith("dana-david-001-"), "admin download link with filename");
assert((await call("DELETE", `/api/admin/videos/${v2}`, null, "admin")).status === 200, "admin deletes a video");
r = await call("POST", "/api/admin/events/dana-david/couple-link", null, "admin");
const ctok = r.data.coupleLink.split("#")[1];
assert((await call("GET", "/api/couple", null, "bad")).status === 401, "couple needs valid token");
r = await call("GET", "/api/couple", null, ctok);
assert(r.status === 200 && r.data.event.coupleNames === "דנה ודוד" && r.data.guestLink.endsWith("/e/dana-david") && Array.isArray(r.data.videos), "couple sees event, link and videos");
assert(!JSON.stringify(r.data).includes("r2_key") && !JSON.stringify(r.data).includes("phone"), "couple response hides keys and guest phones");
r = await call("PUT", "/api/couple/invitees", { invitees: [{ name: "א", phone: "050-1111111" }, { name: "ב", phone: "0501111111" }, { name: "ג", phone: "abc" }, { name: "ד", phone: "+972 52 222 2222" }] }, ctok);
assert(r.data.saved === 2, "invitees saved, deduped, invalid dropped");
r = await call("PUT", "/api/couple/invitees", { invitees: [{ name: "ה", phone: "0533333333" }] }, ctok);
r = await call("GET", "/api/couple/invitees", null, ctok);
assert(r.data.invitees.length === 1 && r.data.invitees[0].phone === "0533333333", "new upload replaces the list");
// --- raw video retention ---
r = await call("POST", "/api/admin/events", { slug: "old", couple_names: "ישן", event_date: "2026-01-01", upload_closes_at: "2026-01-03T18:00:00Z" }, "admin");
const oldTok = (await call("POST", "/api/events/old/join", { name: "x", phone: "0509999999" })).data.token;
tables.events.find((e) => e.slug === "old").upload_closes_at = "2099-01-01T00:00:00Z";
const ov = (await call("POST", "/api/me/uploads", { contentType: "video/mp4", size: 5, fileName: "o.mp4" }, oldTok)).data.videoId;
const okey = tables.videos.find((v) => v.id === ov).r2_key; r2.set(okey, 5);
await call("POST", `/api/me/uploads/${ov}/complete`, null, oldTok);
tables.events.find((e) => e.slug === "old").upload_closes_at = "2026-01-03T18:00:00Z";
let pr = await purgeRaw(env, Date.parse("2026-11-25T00:00:00Z"));
assert(pr.length === 0 && r2.has(okey), "not backed up -> nothing deleted even after 30 days");
r = await call("POST", "/api/admin/events/old/backed-up", {}, "admin");
assert(r.data.rawBackedUpAt && r.data.rawDeleteAt.startsWith("2026-02-02"), "mark backed up; delete date = close + 30 days");
pr = await purgeRaw(env, Date.parse("2026-01-20T00:00:00Z"));
assert(pr.length === 0 && r2.has(okey), "backed up but within 30 days -> kept");
pr = await purgeRaw(env, Date.parse("2026-02-03T00:00:00Z"));
assert(pr[0]?.deleted === 1 && !r2.has(okey) && tables.videos.find((v) => v.id === ov).status === "purged", "after 30 days and backup -> raw deleted");
assert(tables.events.find((e) => e.slug === "old").raw_purged_at && (await call("GET", "/api/events/old")).status === 200, "event itself kept, marked purged");
r = await worker.fetch(new Request("https://vishare.co.il/e/dana-david"), env);
assert((await r.text()) === "asset:/guest", "guest link serves guest page");
console.log("ALL PASSED");
