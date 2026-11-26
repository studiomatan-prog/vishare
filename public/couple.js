// VISHARE couple page. Private link: /couple#<token>
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "vishare:couple";
  let token = location.hash.slice(1);
  try { if (token) localStorage.setItem(KEY, token); else token = localStorage.getItem(KEY) || ""; } catch {}
  let D = null, parsed = null, size = 0;
  // Printed on every table sign and roll-up, for every event.
  const BRAND = { tagline: "רוצים VISHARE באירוע שלכם?", phoneLabel: "להזמנות:", phone: "052-6549971", site: "vishare.co.il" };
  const SIZES = [["שלט שולחן 10×15", 100, 150], ["A5", 148, 210], ["A4", 210, 297]];

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "משהו לא עבד. נסו לרענן את הדף");
    return data;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let tt; const toast = (t) => { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 3000); };
  async function copy(t) { try { await navigator.clipboard.writeText(t); toast("הועתק"); } catch { prompt("העתיקו:", t); } }

  const message = () => `היי, כאן ${D.event.coupleNames} 🤍
${D.event.eventType === "חתונה" ? "מחר החתונה שלנו" : "מחר האירוע שלנו"}, ואנחנו רוצים לראות אותו גם דרך העיניים שלכם.

במהלך הערב היכנסו ללינק וצלמו אותנו. כל סרטון מגיע ישר אלינו:
${D.guestLink}

מחכים לכם!`;

  async function start() {
    if (!token) return fail("חסר הקוד בלינק. פתחו את הלינק המלא שקיבלתם מ־LOCO.");
    try { D = await api("/api/couple"); } catch (e) { return fail(e.message); }
    const e = D.event;
    $("loading").hidden = true; $("app").hidden = false;
    document.title = `${e.coupleNames} · VISHARE`;
    $("kind").textContent = e.eventType === "חתונה" ? "החתונה של" : e.eventType;
    $("names").textContent = e.coupleNames;
    $("where").textContent = [new Date(e.eventDate + "T12:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" }), e.venue].filter(Boolean).join(" · ");
    $("st-guests").textContent = D.stats.guests; $("st-videos").textContent = D.stats.videos;
    $("st-close").textContent = new Date(e.uploadClosesAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).replace(", ", "\n");
    $("link").textContent = D.guestLink.replace(/^https?:\/\//, "");
    $("msg").textContent = message();
    $("wa").href = "https://wa.me/?text=" + encodeURIComponent(message());
    $("copy-link").onclick = () => copy(D.guestLink);
    $("copy-msg").onclick = () => copy(message());
    loadInvitees();
    renderVideos(); renderEdits(); renderSizes(); drawSign();
  }
  function fail(t) { $("loading").hidden = true; $("error").hidden = false; $("err-text").textContent = t; }

  /* ---------- videos ---------- */
  function rawNote() {
    const e = D.event, n = $("raw-note");
    const fmt = (d) => new Date(d).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" });
    if (e.rawPurgedAt) { n.innerHTML = `<span>🗂️</span><span>הסרטונים הגולמיים מהאורחים נמחקו ב־${fmt(e.rawPurgedAt)}. הסרטונים הערוכים נשארים כאן תמיד.</span>`; n.hidden = false; return; }
    if (!D.videos.length) return;
    const left = (new Date(e.rawDeleteAt) - Date.now()) / 864e5;
    n.innerHTML = `<span>${left < 7 ? "⚠️" : "📥"}</span><span>הסרטונים מהאורחים זמינים להורדה עד <b>${fmt(e.rawDeleteAt)}</b>.${left < 7 ? " כדאי להוריד אותם עכשיו." : ""} הסרטונים הערוכים נשארים כאן תמיד.</span>`;
    n.hidden = false;
  }
  function renderVideos() {
    rawNote();
    const names = [...new Set(D.videos.map((v) => v.guest))];
    $("filter").innerHTML = `<option value="">כל האורחים (${D.videos.length})</option>` + names.map((n) => `<option>${esc(n)}</option>`).join("");
    $("filter").hidden = !D.videos.length;
    const draw = () => {
      const f = $("filter").value; const list = D.videos.filter((v) => !f || v.guest === f);
      $("videos").innerHTML = list.length ? list.map((v) => `<div class="vid"><video src="${esc(v.url)}#t=0.5" preload="metadata" controls playsinline></video>
        <div class="meta"><span>${esc(v.guest)}${v.kind === "greeting" ? " · ברכה" : v.moment ? " · " + esc(v.moment) : ""}</span><a href="${esc(v.downloadUrl)}" download>הורדה</a></div></div>`).join("")
        : `<p class="empty" style="grid-column:1/-1">עוד אין סרטונים. כשהאורחים יתחילו לצלם, הם יופיעו כאן.</p>`;
    };
    $("filter").onchange = draw; draw();
  }
  function renderEdits() {
    $("edits").innerHTML = D.edits.length ? D.edits.map((v) => `<div class="vid"><video src="${esc(v.url)}#t=0.5" preload="metadata" controls playsinline></video>
      <div class="meta"><span>${esc(v.moment)}</span><a href="${esc(v.downloadUrl)}" download>הורדה</a></div></div>`).join("")
      : `<p class="empty" style="grid-column:1/-1">אחרי שההעלאה תיסגר נערוך את הסרטונים, והם יופיעו כאן.</p>`;
  }

  /* ---------- sign + QR ---------- */
  function qrCanvas(px) {
    const div = document.createElement("div");
    new QRCode(div, { text: D.guestLink, width: px, height: px, colorDark: "#2A1730", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    return div.querySelector("canvas");
  }
  function renderSizes() {
    $("sizes").innerHTML = SIZES.map((s, i) => `<button class="chip" aria-pressed="${i === size}" data-i="${i}">${s[0]}</button>`).join("");
    $("sizes").querySelectorAll("button").forEach((b) => (b.onclick = () => { size = +b.dataset.i; renderSizes(); drawSign(); }));
  }
  async function signCanvas(scale) {
    const [, wmm, hmm] = SIZES[size];
    const W = Math.round((wmm / 25.4) * 300 * scale), H = Math.round((hmm / 25.4) * 300 * scale);
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    try { await Promise.all([document.fonts.load("800 80px Rubik"), document.fonts.load("700 80px Rubik"), document.fonts.load("500 80px Oswald"), document.fonts.load("400 40px Assistant")]); } catch {}
    const u = W / 100; // 1% of width
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    const band = Math.round(H * 0.13);
    const gr = g.createLinearGradient(0, 0, W, band); gr.addColorStop(0, "#8E3F9E"); gr.addColorStop(0.55, "#E5446F"); gr.addColorStop(1, "#F6994C");
    g.fillStyle = gr; g.fillRect(0, 0, W, band);
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.direction = "ltr";
    g.font = `500 ${Math.round(u * 9)}px Oswald, "Arial Narrow", sans-serif`; g.fillText("VISHARE", W / 2, band / 2);
    g.direction = "rtl";
    let y = band + u * 13;
    g.fillStyle = "#8E3F9E"; g.font = `700 ${Math.round(u * 7.5)}px Rubik, Arial, sans-serif`; g.fillText("צלמו אותנו!", W / 2, y);
    y += u * 12;
    g.fillStyle = "#D9762E"; let fs = u * 11; g.font = `800 ${Math.round(fs)}px Rubik, Arial, sans-serif`;
    while (g.measureText(D.event.coupleNames).width > W * 0.86 && fs > u * 5) { fs -= u * 0.5; g.font = `800 ${Math.round(fs)}px Rubik, Arial, sans-serif`; }
    g.fillText(D.event.coupleNames, W / 2, y);
    y += u * 9;
    // QR as big as fits: below it come the two text lines, the guest link and the contact band (~44% of width)
    const qs = Math.round(Math.min(W * 0.58, H - y - u * 44));
    const q = qrCanvas(512); g.imageSmoothingEnabled = false;
    const pad = u * 2.5; g.fillStyle = "#fff"; g.strokeStyle = "#ECE1EC"; g.lineWidth = u * 0.4;
    g.beginPath(); g.roundRect((W - qs) / 2 - pad, y - pad, qs + pad * 2, qs + pad * 2, u * 3); g.fill(); g.stroke();
    g.drawImage(q, (W - qs) / 2, y, qs, qs);
    y += qs + pad + u * 9;
    g.fillStyle = "#2A1730"; g.font = `700 ${Math.round(u * 5.4)}px Rubik, Arial, sans-serif`; g.fillText("סורקים, מצלמים, והסרטון מגיע אלינו", W / 2, y);
    y += u * 7;
    g.fillStyle = "#75667A"; g.font = `400 ${Math.round(u * 4.2)}px Assistant, Arial, sans-serif`; g.fillText("בלי להוריד אפליקציה", W / 2, y);
    // Guest link (in case the QR doesn't scan)
    const foot = Math.round(u * 13);
    g.direction = "ltr"; g.font = `500 ${Math.round(u * 3.6)}px Oswald, Arial, sans-serif`; g.fillStyle = "#8E3F9E";
    g.fillText(D.guestLink.replace(/^https?:\/\//, ""), W / 2, H - foot - u * 4.5);
    // LOCO contact band, printed on every sign (BRAND in this file)
    g.fillStyle = "#F5ECF4"; g.fillRect(0, H - foot, W, foot);
    g.direction = "rtl"; g.fillStyle = "#2A1730";
    g.font = `700 ${Math.round(u * 3.6)}px Rubik, Arial, sans-serif`;
    g.fillText(BRAND.tagline, W / 2, H - foot + foot * 0.34);
    g.font = `500 ${Math.round(u * 3.9)}px Rubik, Arial, sans-serif`; g.fillStyle = "#8E3F9E";
    g.fillText(`${BRAND.phoneLabel} ${BRAND.phone}  ·  ${BRAND.site}`, W / 2, H - foot + foot * 0.72);
    return c;
  }
  async function drawSign() {
    const c = await signCanvas(0.35); const s = $("sign");
    s.width = c.width; s.height = c.height; s.getContext("2d").drawImage(c, 0, 0);
  }
  $("pdf").onclick = async () => {
    if (!window.jspdf) return toast("לא הצלחנו לטעון את יוצר ה־PDF. רעננו ונסו שוב");
    $("pdf").disabled = true;
    try {
      const [, w, h] = SIZES[size]; const c = await signCanvas(1);
      const pdf = new jspdf.jsPDF({ unit: "mm", format: [w, h], orientation: "portrait" });
      pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, w, h);
      pdf.save(`vishare-${D.event.slug}-${w}x${h}.pdf`);
    } finally { $("pdf").disabled = false; }
  };
  $("png").onclick = () => {
    const q = qrCanvas(1000); const c = document.createElement("canvas"); c.width = c.height = 1200; const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 1200, 1200); g.imageSmoothingEnabled = false; g.drawImage(q, 100, 100, 1000, 1000);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `vishare-qr-${D.event.slug}.png`; a.click();
  };

  /* ---------- guest list ---------- */
  function parseRows(rows) {
    rows = rows.map((r) => r.map((c) => String(c ?? "").trim())).filter((r) => r.some(Boolean));
    const isPhone = (s) => /^[+\d][\d\-\s().]{7,}$/.test(s) && s.replace(/\D/g, "").length >= 9;
    const cols = Math.max(0, ...rows.map((r) => r.length)); let pc = -1, best = 0;
    for (let c = 0; c < cols; c++) { const k = rows.filter((r) => isPhone(r[c] || "")).length; if (k > best) { best = k; pc = c; } }
    if (pc < 0) return [];
    return rows.filter((r) => isPhone(r[pc] || "")).map((r) => ({ name: r.filter((c, i) => i !== pc && c && !isPhone(c)).slice(0, 2).join(" "), phone: r[pc] }));
  }
  $("xl").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      let rows;
      if (/\.csv$/i.test(f.name)) rows = (await f.text()).split(/\r?\n/).map((l) => l.split(/[,;\t]/));
      else { if (!window.XLSX) throw 0; const wb = XLSX.read(await f.arrayBuffer()); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false }); }
      parsed = parseRows(rows);
      if (!parsed.length) { $("inv-sum").textContent = "לא מצאנו בקובץ עמודה של מספרי טלפון. בדקו את הקובץ ונסו שוב."; return; }
      $("inv-head").innerHTML = "<th>שם</th><th>טלפון</th>";
      $("inv-rows").innerHTML = parsed.map((r) => `<tr><td>${esc(r.name || "—")}</td><td class="ph">${esc(r.phone)}</td></tr>`).join("");
      $("inv-tbl").hidden = false; $("inv-actions").hidden = false;
      const q = D.event.invitedCount;
      $("inv-sum").textContent = q && parsed.length > q
        ? `נמצאו ${parsed.length} מוזמנים בקובץ, והחבילה שלכם כוללת עד ${q}. הסירו מוזמנים מהקובץ, או פנו ל־LOCO כדי להגדיל את החבילה.`
        : `נמצאו ${parsed.length} מוזמנים בקובץ${q ? ` (החבילה כוללת עד ${q})` : ""}. בדקו את הרשימה ולחצו "שמירת הרשימה".`;
      $("inv-actions").hidden = !!(q && parsed.length > q);
    } catch { $("inv-sum").textContent = "לא הצלחנו לקרוא את הקובץ. נסו לשמור אותו מאקסל כ־CSV ולהעלות שוב."; }
  };
  // Saved list with a personal WhatsApp button per guest (sent from the couple's own WhatsApp)
  function firstName(n) { const w = String(n || "").trim().split(/\s+/); return !w[0] ? "" : w[0] === "משפחת" ? w.slice(0, 2).join(" ") : w[0]; }
  function waNum(p) { let d = String(p).replace(/\D/g, ""); if (d.startsWith("972")) return d; if (d.startsWith("0")) d = d.slice(1); return "972" + d; }
  const personal = (n) => message().replace(/^היי,/, firstName(n) ? `היי ${firstName(n)},` : "היי,");
  async function loadInvitees() {
    let list = [];
    try { list = (await api("/api/couple/invitees")).invitees; } catch {}
    if (!list.length) { $("inv-sum").textContent = ""; return; }
    const sent = list.filter((x) => x.status === "sent").length;
    const q = D.event.invitedCount;
    $("inv-sum").textContent = `${list.length}${q ? ` מתוך ${q}` : ""} מוזמנים ברשימה · ${sent} קיבלו הודעה`;
    $("inv-head").innerHTML = "<th>שם</th><th>טלפון</th><th></th>";
    $("inv-rows").innerHTML = list.map((x) => `<tr><td>${esc(x.name || "—")}</td><td class="ph">${esc(x.phone)}</td>
      <td><a class="wa-one${x.status === "sent" ? " sent" : ""}" data-id="${x.id}" target="_blank" rel="noopener"
        href="https://wa.me/${waNum(x.phone)}?text=${encodeURIComponent(personal(x.name))}">${x.status === "sent" ? "✓ נשלח" : "שליחה"}</a></td></tr>`).join("");
    $("inv-tbl").hidden = false; $("inv-actions").hidden = true;
    $("inv-rows").querySelectorAll("a.wa-one").forEach((a) => (a.onclick = () => {
      a.classList.add("sent"); a.textContent = "✓ נשלח";
      api(`/api/couple/invitees/${a.dataset.id}/sent`, { method: "POST" }).then(() => setTimeout(loadInvitees, 1500)).catch(() => {});
    }));
  }

  $("inv-save").onclick = async () => {
    $("inv-save").disabled = true;
    try {
      const r = await api("/api/couple/invitees", { method: "PUT", body: { invitees: parsed } });
      $("inv-sum").textContent = `נשמרו ${r.saved} מוזמנים.` + (r.saved < parsed.length ? ` ${parsed.length - r.saved} שורות דילגנו עליהן: מספר כפול או לא תקין.` : "");
      $("inv-actions").hidden = true; toast("הרשימה נשמרה"); loadInvitees();
    } catch (err) { toast(err.message); } finally { $("inv-save").disabled = false; }
  };

  start();
})();
