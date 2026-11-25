// VISHARE admin (LOCO). Uses /api/admin/* with the ADMIN_TOKEN kept in this browser only.
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "vishare:admin";
  let token = ""; try { token = localStorage.getItem(KEY) || ""; } catch {}
  let events = [];
  const ST = { pre: ["לפני האירוע", "st-pre"], open: ["העלאה פתוחה", "st-open"], edit: ["בעריכה", "st-edit"], done: ["נמסר", "st-done"] };

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error("הסיסמה לא נכונה"); }
    if (!res.ok) throw new Error(data.error || "משהו לא עבד");
    return data;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const fmtDT = (d) => new Date(d).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  function stateOf(e) {
    if (e.status === "done") return "done";
    const today = new Date().toISOString().slice(0, 10);
    if (e.event_date > today) return "pre";
    return new Date(e.upload_closes_at) > new Date() ? "open" : "edit";
  }
  const pill = (s) => `<span class="pill ${ST[s][1]}">${ST[s][0]}</span>`;
  const guestLink = (slug) => `${location.origin}/e/${slug}`;

  /* ---------- auth ---------- */
  function logout() { token = ""; try { localStorage.removeItem(KEY); } catch {} $("dash").hidden = true; $("logout").hidden = true; $("login").hidden = false; }
  $("logout").onclick = logout;
  $("login").onsubmit = async (e) => {
    e.preventDefault(); token = $("tok").value.trim();
    try { await load(); try { localStorage.setItem(KEY, token); } catch {} } catch (err) { toast(err.message); }
  };

  /* ---------- list ---------- */
  async function load() {
    const r = await api("/api/admin/events");
    events = r.events;
    $("login").hidden = true; $("dash").hidden = false; $("logout").hidden = false;
    const vids = events.reduce((a, e) => a + e.videos, 0), guests = events.reduce((a, e) => a + e.guests, 0);
    $("kpis").innerHTML = [["אירועים", events.length], ["אורחים שצילמו", guests], ["סרטונים", vids]]
      .map(([a, b]) => `<div class="kpi"><span>${a}</span><b>${b}</b></div>`).join("");
    $("rows").innerHTML = events.length ? events.map((e) => `<tr data-slug="${esc(e.slug)}">
      <td class="cname"><strong>${esc(e.couple_names)}</strong><span>${esc(e.event_type)}${e.venue ? " · " + esc(e.venue) : ""}</span></td>
      <td class="num">${fmtDate(e.event_date)}</td><td>${esc(e.package)}</td><td>${pill(stateOf(e))}</td>
      <td>${fmtDT(e.upload_closes_at)}</td><td class="num">${e.guests}</td><td class="num">${e.videos}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">עוד אין אירועים. לחצו על ״אירוע חדש״.</td></tr>`;
    $("rows").querySelectorAll("tr[data-slug]").forEach((tr) => (tr.onclick = () => openEvent(tr.dataset.slug)));
  }

  /* ---------- new event ---------- */
  $("new").onclick = () => { $("modal").hidden = false; $("n-names").focus(); };
  $("n-cancel").onclick = () => ($("modal").hidden = true);
  $("n-slug").oninput = () => { $("n-slug").value = $("n-slug").value.toLowerCase().replace(/[^a-z0-9-]/g, ""); $("slug-preview").textContent = "vishare.co.il/e/" + ($("n-slug").value || "…"); };
  $("new-form").onsubmit = async (e) => {
    e.preventDefault(); $("n-submit").disabled = true;
    try {
      const r = await api("/api/admin/events", { method: "POST", body: {
        slug: $("n-slug").value, couple_names: $("n-names").value.trim(), event_type: $("n-type").value, event_date: $("n-date").value,
        venue: $("n-venue").value.trim(), package: $("n-pkg").value, invited_count: Number($("n-inv").value || 0) } });
      $("modal").hidden = true; $("new-form").reset();
      await load();
      openEvent(r.event.slug, r.coupleLink);
      toast("האירוע נוצר");
    } catch (err) { toast(err.message === "כבר קיים" ? "הכתובת הזו כבר תפוסה. בחרו כתובת אחרת" : err.message); }
    finally { $("n-submit").disabled = false; }
  };

  /* ---------- event drawer ---------- */
  async function openEvent(slug, freshCoupleLink) {
    const e = events.find((x) => x.slug === slug); if (!e) return;
    const d = $("drawer");
    d.innerHTML = `<div class="dhead"><button class="x" id="dx" aria-label="סגירה">×</button>
      <span class="meta">${esc(e.event_type)} · ${esc(e.package)}</span><h2>${esc(e.couple_names)}</h2>
      <span class="meta">${fmtDate(e.event_date)}${e.venue ? " · " + esc(e.venue) : ""}</span></div>
      <div class="dbody"><p class="empty">טוען…</p></div>`;
    d.hidden = $("scrim").hidden = false; d.scrollTop = 0;
    $("dx").onclick = closeDrawer;
    let data;
    try { data = await api(`/api/admin/events/${slug}/videos`); } catch (err) { d.querySelector(".dbody").innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const vids = data.videos;
    const byGuest = {};
    vids.forEach((v) => { const k = (v.guest?.name || "אורח") + "|" + (v.guest?.phone || ""); (byGuest[k] ||= []).push(v); });
    const closesLocal = new Date(new Date(e.upload_closes_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    d.querySelector(".dbody").innerHTML = `
      <div class="facts"><div class="fact"><b>${Object.keys(byGuest).length}</b><span>אורחים צילמו</span></div><div class="fact"><b>${vids.length}</b><span>סרטונים</span></div><div class="fact"><b>${(vids.reduce((a, v) => a + (v.size || 0), 0) / 1e9).toFixed(2)}</b><span>GB</span></div></div>
      <div class="card"><h2>לינק לאורחים</h2>
        <div class="linkrow"><span>${esc(guestLink(slug))}</span><button class="btn sm ghost" data-copy="${esc(guestLink(slug))}">העתקה</button></div>
        <div class="qr"><div class="box" id="qrbox"></div><div class="acts"><button class="btn sm" id="qr-dl">הורדת QR (PNG)</button></div></div></div>
      <div class="card"><h2>לינק פרטי לזוג <span class="sub">(דף הזוג עוד בבנייה)</span></h2>
        ${freshCoupleLink ? `<div class="linkrow"><span>${esc(freshCoupleLink)}</span><button class="btn sm ghost" data-copy="${esc(freshCoupleLink)}">העתקה</button></div><p class="sub">שמרו או שלחו לזוג עכשיו. מטעמי אבטחה הלינק לא נשמר במערכת.</p>`
          : `<p class="sub">הלינק לזוג מוצג רק כשהוא נוצר. אם צריך, יוצרים חדש, והישן מפסיק לעבוד.</p>`}
        <div class="acts"><button class="btn sm ghost" id="new-couple">יצירת לינק חדש לזוג</button></div></div>
      <div class="card"><h2>מועד סגירת ההעלאה</h2>
        <div class="acts"><input type="datetime-local" id="close-at" value="${closesLocal}" style="padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;background:var(--bg)"><button class="btn sm" id="close-save">שמירה</button><button class="btn sm ghost" id="close-now">סגירה עכשיו</button></div></div>
      <div class="card"><div class="head"><h2>סרטונים</h2>${vids.length ? `<div class="acts"><button class="btn sm" id="dl-all">הורדת הכול</button><button class="btn sm ghost" id="copy-all">העתקת כל הקישורים</button></div>` : ""}</div>
        ${vids.length ? Object.entries(byGuest).map(([k, list]) => { const [n, ph] = k.split("|"); return `<div class="guest"><h3>${esc(n)} <span>${esc(ph)}</span></h3><div class="vids">${list.map((v) => `
          <div class="vid"><video src="${esc(v.url)}#t=0.5" preload="metadata" controls playsinline></video>
            <div class="meta">${v.kind === "greeting" ? '<span class="tag">ברכה</span>' : v.moment ? `<span class="tag">${esc(v.moment)}</span>` : `<span>${new Date(v.createdAt).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}</span>`}
              <span><a href="${esc(v.downloadUrl)}" download>הורדה</a><button data-del="${v.id}">מחיקה</button></span></div></div>`).join("")}</div></div>`; }).join("")
          : `<p class="empty">עוד אין סרטונים באירוע הזה.</p>`}
      </div>`;

    try { new QRCode($("qrbox"), { text: guestLink(slug), width: 130, height: 130, colorDark: "#2A1730", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); } catch { $("qrbox").textContent = "QR"; }
    $("qr-dl").onclick = () => {
      const src = $("qrbox").querySelector("canvas");
      if (!src) return toast("ה־QR עוד לא מוכן");
      // Print-ready: 1200px with a white margin
      const c = document.createElement("canvas"); c.width = c.height = 1200; const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, 1200, 1200); g.imageSmoothingEnabled = false; g.drawImage(src, 100, 100, 1000, 1000);
      const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `vishare-qr-${slug}.png`; a.click();
    };
    d.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    $("new-couple").onclick = async () => {
      if (!confirm("ליצור לינק חדש לזוג? הלינק הקודם יפסיק לעבוד.")) return;
      try { const r = await api(`/api/admin/events/${slug}/couple-link`, { method: "POST" }); openEvent(slug, r.coupleLink); } catch (err) { toast(err.message); }
    };
    const saveClose = async (iso) => {
      try { await api(`/api/admin/events/${slug}`, { method: "PATCH", body: { upload_closes_at: iso } }); toast("נשמר"); await load(); openEvent(slug); } catch (err) { toast(err.message); }
    };
    $("close-save").onclick = () => { const v = $("close-at").value; if (v) saveClose(new Date(v).toISOString()); };
    $("close-now").onclick = () => { if (confirm("לסגור את ההעלאה לאירוע עכשיו?")) saveClose(new Date().toISOString()); };
    d.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("למחוק את הסרטון? אי אפשר לשחזר.")) return;
      try { await api(`/api/admin/videos/${b.dataset.del}`, { method: "DELETE" }); toast("נמחק"); await load(); openEvent(slug); } catch (err) { toast(err.message); }
    }));
    const all = $("dl-all");
    if (all) all.onclick = async () => {
      toast(`מוריד ${vids.length} סרטונים. אם הדפדפן שואל, אשרו הורדה של כמה קבצים.`);
      for (const v of vids) { const a = document.createElement("a"); a.href = v.downloadUrl; a.download = v.fileName; document.body.append(a); a.click(); a.remove(); await new Promise((r) => setTimeout(r, 800)); }
    };
    const ca = $("copy-all");
    if (ca) ca.onclick = () => copy(vids.map((v) => v.downloadUrl).join("\n"));
  }
  function closeDrawer() { $("drawer").hidden = $("scrim").hidden = true; $("drawer").innerHTML = ""; }
  $("scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (k) => { if (k.key === "Escape") { closeDrawer(); $("modal").hidden = true; } });

  async function copy(t) {
    try { await navigator.clipboard.writeText(t); toast("הועתק"); } catch { prompt("העתיקו:", t); }
  }
  let tt; function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 3200); }

  if (token) load().catch(() => logout()); else logout();
})();
