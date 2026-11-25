// Smoke test for the Worker API with an in-memory fake of Supabase REST and R2.
import worker from "../worker/src/index.js";

const tables = { events: [], guests: [], videos: [], edits: [] };
const r2 = new Map();
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const table = u.pathname.split("/").pop();
  const rows = tables[table];
  const filters = [...u.searchParams].filter(([k]) => !["select", "order"].includes(k));
  const match = (r) => filters.every(([k, v]) => String(r[k]) === v.replace(/^eq\./, ""));
  const method = init.method || "GET";
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (method === "GET") return ok(rows.filter(match).map((r) => (table === "videos" ? { ...r, guests: tables.guests.find((g) => g.id === r.guest_id) } : r)));
  if (method === "POST") { const row = { id: uuid(), created_at: new Date().toISOString(), status: table === "videos" ? "pending" : "pre", ...JSON.parse(init.body) }; rows.push(row); return ok([row]); }
  if (method === "PATCH") { const b = JSON.parse(init.body); rows.filter(match).forEach((r) => Object.assign(r, b)); return ok(rows.filter(match)); }
};

const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", R2_ACCOUNT_ID: "acc", R2_BUCKET: "vishare-videos",
  R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK", ADMIN_TOKEN: "admin",
  VIDEOS: { head: async (k) => (r2.has(k) ? { size: r2.get(k) } : null), delete: async (k) => r2.delete(k) },
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
r = await worker.fetch(new Request("https://vishare.co.il/e/dana-david"), env);
assert((await r.text()) === "asset:/guest", "guest link serves guest page");
console.log("ALL PASSED");
