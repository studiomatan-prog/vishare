// VISHARE guest page. Talks to the Worker API; uploads go straight to R2 via presigned URLs.
(() => {
  const $ = (id) => document.getElementById(id);
  const slug = (location.pathname.match(/^\/e\/([a-z0-9-]+)/) || [])[1];
  const KEY = `vishare:${slug}`;
  const MOMENTS = ["צילומי חוץ", "חופה", "ריקודים", "סלואו"];
  const VIEWS = ["loading", "error", "welcome", "home", "upload", "greet", "mine", "closed"];
  const st = { ev: null, token: load(), guest: null, view: "loading", stack: [], moment: null, mine: [], current: null, active: 0 };

  /* ---------- storage & api ---------- */
  function load() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
  function save(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} }
  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json", ...(st.token ? { authorization: `Bearer ${st.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { save(""); st.token = ""; }
    if (!res.ok) throw Object.assign(new Error(data.error || "משהו לא עבד. נסו שוב"), { status: res.status });
    return data;
  }

  /* ---------- views ---------- */
  function show(v, push = true) {
    if (push && st.view !== v) st.stack.push(st.view);
    st.view = v;
    VIEWS.forEach((k) => ($("v-" + k).hidden = k !== v));
    $("back").hidden = !["upload", "greet", "mine"].includes(v);
    if (v === "upload") renderChips();
    if (v === "mine") loadMine();
    window.scrollTo(0, 0);
  }
  $("back").onclick = () => show(st.stack.pop() || "home", false);
  document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) show(g.dataset.go); });

  function fail(title, text) { $("err-title").textContent = title; $("err-text").textContent = text || ""; show("error", false); }

  function fillEvent() {
    const e = st.ev;
    const d = new Date(e.eventDate + "T12:00:00");
    const date = d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
    const close = new Date(e.uploadClosesAt).toLocaleString("he-IL", { weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    document.querySelectorAll("[data-names]").forEach((n) => (n.textContent = e.coupleNames));
    document.querySelectorAll("[data-kind]").forEach((n) => (n.textContent = e.eventType === "חתונה" ? "החתונה של" : e.eventType));
    document.querySelectorAll("[data-where]").forEach((n) => (n.textContent = [date, e.venue].filter(Boolean).join(" · ")));
    document.querySelectorAll("[data-close]").forEach((n) => (n.textContent = close));
    document.querySelectorAll(".mono").forEach((n) => (n.textContent = e.coupleNames.trim().charAt(0)));
    document.title = `${e.coupleNames} · VISHARE`;
  }

  /* ---------- start ---------- */
  async function start() {
    if (!slug) return fail("הלינק לא תקין", "בקשו מהזוג את הלינק לאירוע");
    try {
      if (st.token) {
        try {
          const me = await api("/api/me");
          if (me.event.slug === slug) { st.guest = me.guest; st.ev = me.event; return enter(); }
        } catch {}
      }
      st.ev = await api(`/api/events/${slug}`);
      fillEvent();
      show(st.ev.open ? "welcome" : "closed", false);
    } catch (e) {
      fail(e.status === 404 ? "האירוע לא נמצא" : "משהו לא עבד", e.status === 404 ? "בדקו את הלינק שקיבלתם מהזוג" : "בדקו את החיבור לאינטרנט ורעננו את הדף");
    }
  }
  function enter() {
    fillEvent();
    $("hi").textContent = `שלום ${st.guest.name}, ברוכים הבאים ל${st.ev.eventType === "חתונה" ? "חתונה של" : st.ev.eventType + " של"}`;
    st.stack = [];
    if (!st.ev.open) { $("closed-mine").hidden = false; show("closed", false); }
    else show("home", false);
    refreshCount();
  }

  /* ---------- join ---------- */
  const phoneOk = (p) => /^0\d{8,9}$/.test(p.replace(/\D/g, "").replace(/^972/, "0"));
  const check = () => ($("go").disabled = !($("g-name").value.trim() && phoneOk($("g-phone").value)));
  $("g-name").oninput = check; $("g-phone").oninput = check;
  $("join").onsubmit = async (e) => {
    e.preventDefault();
    $("go").disabled = true; $("go").textContent = "נכנסים…";
    try {
      const r = await api(`/api/events/${slug}/join`, { method: "POST", body: { name: $("g-name").value, phone: $("g-phone").value } });
      st.token = r.token; save(r.token); st.guest = r.guest;
      enter();
    } catch (err) { toast(err.message); }
    finally { $("go").textContent = "כניסה לאירוע"; check(); }
  };

  /* ---------- moments ---------- */
  function renderChips() {
    $("chips").innerHTML = "";
    MOMENTS.forEach((m) => {
      const b = document.createElement("button");
      b.className = "chip"; b.textContent = m; b.setAttribute("aria-pressed", st.moment === m);
      b.onclick = () => { st.moment = st.moment === m ? null : m; renderChips(); };
      $("chips").append(b);
    });
  }

  /* ---------- upload ---------- */
  function pick(files, isGreet) {
    if (!files.length) return;
    if (!isGreet && st.view !== "upload") { $("up-files").innerHTML = ""; show("upload"); }
    [...files].forEach((f) => uploadOne(f, isGreet ? $("gr-files") : $("up-files"), isGreet));
  }
  $("cam-in").onchange = (e) => { pick(e.target.files, false); e.target.value = ""; };
  $("gal-in").onchange = (e) => { pick(e.target.files, false); e.target.value = ""; };
  $("gr-in").onchange = (e) => { pick(e.target.files, true); e.target.value = ""; };

  async function uploadOne(f, list, isGreet) {
    const row = document.createElement("div"); row.className = "file";
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "metadata";
    let local = ""; try { local = URL.createObjectURL(f); v.src = local + "#t=0.5"; } catch {}
    const info = document.createElement("div");
    info.innerHTML = '<div class="nm"></div><div class="prog"><i></i></div><div class="st">מתחיל…</div>';
    info.querySelector(".nm").textContent = isGreet ? "ברכה לזוג" : (st.moment ? st.moment : f.name);
    const x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "מחיקת הסרטון");
    row.append(v, info, x); list.prepend(row);
    const bar = info.querySelector("i"), stt = info.querySelector(".st");
    let xhr = null, videoId = null, done = false;
    st.active++;

    x.onclick = async () => {
      if (xhr && !done) xhr.abort();
      row.remove();
      if (videoId && done) { try { await api(`/api/me/videos/${videoId}`, { method: "DELETE" }); refreshCount(); toast("הסרטון נמחק"); } catch (e) { toast(e.message); } }
    };

    try {
      const r = await api("/api/me/uploads", { method: "POST", body: {
        kind: isGreet ? "greeting" : "clip", moment: st.moment, contentType: f.type || "video/mp4", size: f.size, fileName: f.name } });
      videoId = r.videoId;
      await new Promise((resolve, reject) => {
        xhr = new XMLHttpRequest();
        xhr.open("PUT", r.uploadUrl);
        xhr.setRequestHeader("content-type", f.type || "video/mp4");
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const p = Math.round((e.loaded / e.total) * 100); bar.style.width = p + "%"; stt.textContent = `עולה… ${p}%`; } };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("ההעלאה נכשלה")));
        xhr.onerror = () => reject(new Error("החיבור נקטע"));
        xhr.onabort = () => reject(Object.assign(new Error("בוטל"), { aborted: true }));
        xhr.send(f);
      });
      await api(`/api/me/uploads/${videoId}/complete`, { method: "POST" });
      done = true; row.classList.add("done"); bar.style.width = "100%";
      stt.textContent = "✓ הגיע ל" + st.ev.coupleNames;
      refreshCount();
      if (isGreet) openThanks("הברכה שלך הגיעה ל" + st.ev.coupleNames + ".");
    } catch (e) {
      if (e.aborted) return;
      row.classList.add("err"); stt.textContent = e.message + " · ";
      const retry = document.createElement("a"); retry.href = "#"; retry.textContent = "לנסות שוב";
      retry.onclick = (ev) => { ev.preventDefault(); row.remove(); uploadOne(f, list, isGreet); };
      stt.append(retry);
    } finally {
      st.active--;
    }
  }
  $("up-done").onclick = () => {
    if (st.active) return toast("יש סרטונים שעוד עולים. חכו שיסומנו ✓");
    st.stack = []; show("home", false); toast("תודה! הסרטונים אצל " + st.ev.coupleNames);
  };
  window.addEventListener("beforeunload", (e) => { if (st.active) { e.preventDefault(); e.returnValue = ""; } });

  function openThanks(t) { $("th-text").textContent = t + " רוצים להוסיף עוד? אפשר לחזור לכאן בכל רגע."; $("thanks").hidden = false; }
  $("th-mine").onclick = () => { $("thanks").hidden = true; show("mine"); };
  $("th-home").onclick = () => { $("thanks").hidden = true; st.stack = []; show("home", false); };

  /* ---------- my videos ---------- */
  async function refreshCount() {
    try { const r = await api("/api/me/videos"); st.mine = r.videos; $("mine-count").textContent = r.videos.length; } catch {}
  }
  async function loadMine() {
    const g = $("mine-grid");
    g.innerHTML = '<p class="empty">טוען…</p>';
    try {
      const r = await api("/api/me/videos"); st.mine = r.videos; $("mine-count").textContent = r.videos.length;
      if (!r.videos.length) { g.innerHTML = '<p class="empty">עוד לא צילמת.<br>לחצו על ״צלמו עכשיו״ במסך הראשי.</p>'; return; }
      g.innerHTML = "";
      r.videos.forEach((it) => {
        const b = document.createElement("button"); b.className = "cell"; b.setAttribute("aria-label", "צפייה בסרטון");
        const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = it.url + "#t=0.5";
        b.append(v);
        if (it.kind === "greeting" || it.moment) { const t = document.createElement("span"); t.className = "tag"; t.textContent = it.kind === "greeting" ? "ברכה" : it.moment; b.append(t); }
        b.onclick = () => openViewer(it);
        g.append(b);
      });
    } catch (e) { g.innerHTML = `<p class="empty">${e.message}</p>`; }
  }
  function openViewer(it) {
    st.current = it;
    const v = document.createElement("video"); v.controls = true; v.playsInline = true; v.src = it.url;
    $("vw-media").innerHTML = ""; $("vw-media").append(v);
    $("vw-del").hidden = false;
    $("viewer").hidden = false;
  }
  const closeViewer = () => { $("viewer").hidden = true; $("vw-media").innerHTML = ""; };
  $("vw-close").onclick = closeViewer;
  $("vw-del").onclick = () => ($("confirm").hidden = false);
  $("cf-no").onclick = () => ($("confirm").hidden = true);
  $("cf-yes").onclick = async () => {
    $("confirm").hidden = true;
    try { await api(`/api/me/videos/${st.current.id}`, { method: "DELETE" }); closeViewer(); toast("הסרטון נמחק"); loadMine(); }
    catch (e) { toast(e.message); }
  };

  let tt; function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 3000); }

  start();
})();
