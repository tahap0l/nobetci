// The live demo: the app's real island, built for the web into /island/ (see
// vite.config.ts), shown in a frame. The hero runs its tour; the demo section
// lets the visitor pick a scenario and a mascot. Nothing leaves the page: the
// island's decisions and data are simulated by its demo mode.
//
// Off screen the frames stop drawing (`content-visibility: auto` on .stage).
// With reduced motion the hero shows a still island instead of the tour, and a
// button pauses or plays the tour for everyone.

(() => {
  const site = window.NobetciSite;
  if (!site) return;
  const { base } = site;
  const L = (tr, en) => (site.lang() === "tr" ? tr : en);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const SCENES = [
    { id: "tour", q: "demo=tour", dot: "violet", name: ["Tur", "Tour"], note: ["Her şey sırayla", "Everything, in turn"] },
    { id: "critical", q: "demo=critical", dot: "red", name: ["Kritik istek", "Critical request"], note: ["Basılı tutarak onay", "Approve by holding"] },
    { id: "low", q: "demo=low", dot: "green", name: ["Düşük riskli istek", "Low-risk request"], note: ["Tek tıkla onay", "One click to allow"] },
    { id: "question", q: "demo=question", dot: "cyan", name: ["Claude'un sorusu", "Claude's question"], note: ["Seç ya da kendin yaz", "Pick or write your own"] },
    { id: "plan", q: "demo=plan", dot: "violet", name: ["Plan onayı", "A plan to approve"], note: ["Onayla ya da notla geri gönder", "Approve, or send back a note"] },
    { id: "batch", q: "demo=batch", dot: "green", name: ["Toplu onay", "Batch approval"], note: ["Düşük risklilere tek tık", "One click for the low-risk ones"] },
    { id: "write", q: "demo=write", dot: "amber", name: ["Dosya yazma", "File write"], note: ["Değişikliğin önizlemesi", "A preview of the change"] },
    { id: "session", q: "demo=session", dot: "cyan", name: ["Oturum ayrıntısı", "Session details"], note: ["Değişen dosyalar, limitler", "Changed files, limits"] },
    { id: "assistant", q: "demo=assistant&lib=1&text=", dot: "violet", name: ["Asistan", "Assistant"], note: ["Hazır promptlar açık", "With prompt ideas"] },
    { id: "media", q: "demo=overview&media=art&page=media", dot: "green", name: ["Müzik ve odak", "Music and focus"], note: ["İleri sarılabilir", "Seekable"] },
    { id: "agenda", q: "demo=overview&media=art&page=agenda", dot: "cyan", name: ["Ajanda", "Agenda"], note: ["Ekle, işaretle, sil", "Add, tick, delete"] },
    { id: "weather", q: "demo=overview&media=art&weather=61&page=weather", dot: "cyan", name: ["Hava durumu", "Weather"], note: ["Animasyonlu tahmin", "Animated forecast"] },
    { id: "system", q: "demo=overview&media=art&page=system", dot: "amber", name: ["Sistem", "System"], note: ["CPU · RAM · GPU", "CPU · RAM · GPU"] },
    { id: "compact", q: "demo=compact", dot: "violet", name: ["Kompakt ada", "Compact island"], note: ["Göze batmadan", "Out of the way"] },
  ];
  const THEMES = [
    ["owl", "Baykuş", "Owl"], ["wolf", "Kurt", "Wolf"], ["hawk", "Şahin", "Hawk"], ["octopus", "Ahtapot", "Octopus"],
    ["lion", "Aslan", "Lion"], ["canary", "Kanarya", "Canary"], ["eagle", "Kartal", "Eagle"],
  ];
  /** The tour's first screen, standing still. */
  const STILL = "demo=overview&media=art&weather=2";
  /** The island panel (PANEL_W × PANEL_H in src/island/layout.ts). */
  const PANEL = { width: 720, height: 460 };
  /** Below this the lab's island is not shrunk further: it pans sideways instead. */
  const PAN_SCALE = 0.75;
  /** Where the island's content column starts, left of it is the mascot (island px). */
  const CONTENT_X = 172;

  const theme = () => document.documentElement.dataset.mascotTheme || "owl";
  const url = (q, mascot) => `${base}island/?${q}&bg=none&lang=${site.lang()}&theme=${mascot || theme()}`;

  /** Keeps the 720 × 460 island scaled to its stage; with `pan`, a phone pans instead of shrinking it unreadably. */
  function fit(stage, frame, { inset = 40, pan = false, onFit } = {}) {
    const apply = () => {
      const width = stage.clientWidth;
      let scale = Math.min(1.15, (width - inset) / PANEL.width);
      let pannable = false;
      if (pan && scale < PAN_SCALE) {
        if (width / PANEL.width >= PAN_SCALE) scale = width / PANEL.width;
        else {
          scale = PAN_SCALE;
          pannable = true;
        }
      }
      stage.style.setProperty("--scale", String(Math.max(0.3, scale)));
      stage.classList.toggle("is-pannable", pannable);
      onFit?.(scale, pannable);
    };
    new ResizeObserver(apply).observe(stage);
    apply();
    frame.addEventListener("load", () => stage.classList.add("is-live"));
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children.filter(Boolean));
    return node;
  }

  // ── Hero ────────────────────────────────────────────────────────────────
  const hero = document.querySelector("[data-stage]");
  const heroFrame = hero?.querySelector("iframe");
  const pause = hero?.querySelector("[data-stage-pause]");
  // Reduced motion: no slideshow unless the visitor asks for it.
  let paused = reduced.matches;
  const heroUrl = () => url(paused ? STILL : "demo=tour");
  function labelPause() {
    if (!pause) return;
    pause.hidden = false;
    pause.dataset.state = paused ? "paused" : "playing";
    pause.querySelector("[data-stage-pause-label]").textContent = site.t(paused ? "stagePlay" : "stagePause");
    pause.setAttribute("aria-label", site.t(paused ? "stagePlayLabel" : "stagePauseLabel"));
  }
  if (hero && heroFrame) {
    fit(hero, heroFrame, { inset: 20 });
    labelPause();
    pause?.addEventListener("click", () => {
      paused = !paused;
      labelPause();
      if (heroFrame.src) heroFrame.src = heroUrl();
    });
    // After the page has painted: the poster image is the first impression.
    const start = () => { heroFrame.src = heroUrl(); };
    if (document.readyState === "complete") setTimeout(start, 300);
    else addEventListener("load", () => setTimeout(start, 300), { once: true });
  }

  // ── Demo section ────────────────────────────────────────────────────────
  const lab = document.querySelector("[data-lab]");
  let scene = reduced.matches ? SCENES[1] : SCENES[0];
  let labTheme = null;
  let labFrame = null;
  let labStage = null;
  let labView = null;
  let labPannable = false;

  function hintText() {
    return labPannable ? L("Tıkla, dene · yana kaydır", "Click around · swipe sideways") : L("Tıkla, dene", "Click around");
  }

  /** On a phone, start where the card's content begins; the mascot is a swipe to the left. */
  function alignView(scale) {
    if (!labView) return;
    labView.scrollLeft = labPannable ? Math.round(CONTENT_X * scale) : 0;
  }

  function loadLab() {
    if (!labFrame) return;
    labStage.classList.remove("is-live");
    labFrame.src = url(scene.q, labTheme);
    alignView(Number(labStage.style.getPropertyValue("--scale")) || 1);
  }

  /** In a row that scrolls sideways (phones), brings the chosen button into view. */
  function reveal(button) {
    const row = button.parentElement;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const left = button.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + button.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.max(0, left - 12);
    }
  }

  /** The chosen scenario and mascot, marked in place: the buttons (and keyboard focus) stay. */
  function markLab() {
    if (!lab) return;
    for (const button of lab.querySelectorAll(".lab-scene")) {
      button.setAttribute("aria-pressed", String(button.dataset.scene === scene.id));
    }
    for (const button of lab.querySelectorAll(".lab-theme")) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === (labTheme || theme())));
    }
  }

  function buildLab() {
    if (!lab) return;
    const scenes = el("div", { class: "lab-scenes", role: "group", "aria-label": L("Senaryolar", "Scenarios") },
      ...SCENES.map((s) => el("button", {
        type: "button", class: "lab-scene", "aria-pressed": String(s === scene), "data-scene": s.id,
        onclick: (event) => { scene = s; markLab(); reveal(event.currentTarget); loadLab(); },
      }, el("span", { class: `dot dot-${s.dot}`, "aria-hidden": "true" }),
      el("span", {}, document.createTextNode(L(...s.name)), el("small", { text: L(...s.note) })))));
    const themes = el("div", { class: "lab-themes", role: "group", "aria-label": L("Maskot", "Mascot") },
      ...THEMES.map(([id, tr, en]) => el("button", {
        type: "button", class: "lab-theme", "aria-pressed": String((labTheme || theme()) === id), "data-theme": id,
        onclick: (event) => { labTheme = id; markLab(); reveal(event.currentTarget); loadLab(); },
      }, document.createTextNode(L(tr, en)))));
    const side = el("aside", { class: "lab-side" },
      el("h3", { text: L("Senaryo", "Scenario") }), scenes,
      el("h3", { text: L("Maskot", "Mascot") }), themes,
      el("p", { class: "lab-note", text: L("Simülasyon: bilgisayarında komut çalışmaz, veri gönderilmez.", "A simulation: nothing runs on your computer and nothing is sent.") }));
    if (!labStage) {
      labFrame = el("iframe", { class: "stage-frame", title: L("Nöbetçi canlı demo", "Nöbetçi live demo") });
      labView = el("div", { class: "stage-view" }, el("div", { class: "frame-box" }, labFrame));
      labStage = el("div", { class: "stage lab-stage" },
        el("div", { class: "stage-bar", "aria-hidden": "true" }, el("i"), el("span", { text: "Nöbetçi" })),
        labView,
        el("span", { class: "stage-hint" }, el("span", { class: "live-dot", "aria-hidden": "true" }),
          el("span", { text: hintText() })));
      fit(labStage, labFrame, {
        pan: true,
        onFit: (scale, pannable) => {
          const changed = pannable !== labPannable;
          labPannable = pannable;
          if (changed) {
            labStage.querySelector(".stage-hint span:last-child").textContent = hintText();
            alignView(scale);
          }
        },
      });
      // Load when the section comes near, not with the page.
      new IntersectionObserver(([entry], io) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        loadLab();
      }, { rootMargin: "300px" }).observe(labStage);
    } else {
      labStage.querySelector(".stage-hint span:last-child").textContent = hintText();
      labFrame.title = L("Nöbetçi canlı demo", "Nöbetçi live demo");
    }
    lab.replaceChildren(side, labStage);
    for (const pressed of side.querySelectorAll('[aria-pressed="true"]')) reveal(pressed);
  }
  buildLab();

  // The language and the site theme reach the frames too.
  site.onLanguage(() => {
    labelPause();
    if (heroFrame?.src) heroFrame.src = heroUrl();
    buildLab();
    if (labFrame?.src) loadLab();
  });
  let lastTheme = theme();
  new MutationObserver(() => {
    if (theme() === lastTheme) return;
    lastTheme = theme();
    if (heroFrame?.src) heroFrame.src = heroUrl();
    if (!labTheme) { markLab(); if (labFrame?.src) loadLab(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mascot-theme"] });
})();
