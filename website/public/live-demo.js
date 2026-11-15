// The live demo: the app's real island, built for the web into /island/ (see
// vite.config.ts), shown in a frame. The hero runs its tour; the demo section
// lets the visitor pick a scenario and a mascot. Nothing leaves the page: the
// island's decisions and data are simulated by its demo mode.

(() => {
  const site = window.NobetciSite;
  if (!site) return;
  const { base } = site;
  const L = (tr, en) => (site.lang() === "tr" ? tr : en);

  const SCENES = [
    { id: "tour", q: "demo=tour", dot: "violet", name: ["Tur", "Tour"], note: ["Her şey sırayla", "Everything, in turn"] },
    { id: "critical", q: "demo=critical", dot: "red", name: ["Kritik istek", "Critical request"], note: ["Basılı tutarak onay", "Approve by holding"] },
    { id: "low", q: "demo=low", dot: "green", name: ["Düşük riskli istek", "Low-risk request"], note: ["Tek tıkla onay", "One click to allow"] },
    { id: "write", q: "demo=write", dot: "amber", name: ["Dosya yazma", "File write"], note: ["Değişikliğin önizlemesi", "A preview of the change"] },
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

  const theme = () => document.documentElement.dataset.mascotTheme || "owl";
  const url = (q, mascot) => `${base}island/?${q}&bg=none&lang=${site.lang()}&theme=${mascot || theme()}`;

  /** Keeps a 720×460 frame scaled to its stage's width. */
  function fit(stage, frame, inset = 40) {
    const apply = () => {
      const scale = Math.min(1.15, (stage.clientWidth - inset) / 720);
      stage.style.setProperty("--scale", String(Math.max(0.3, scale)));
    };
    new ResizeObserver(apply).observe(stage);
    apply();
    frame.addEventListener("load", () => stage.classList.add("is-live"));
  }

  // ── Hero ────────────────────────────────────────────────────────────────
  const hero = document.querySelector("[data-stage]");
  const heroFrame = hero?.querySelector("iframe");
  if (hero && heroFrame) {
    fit(hero, heroFrame, 20);
    // After the page has painted: the poster image is the first impression.
    const start = () => { heroFrame.src = url("demo=tour"); };
    if (document.readyState === "complete") setTimeout(start, 300);
    else addEventListener("load", () => setTimeout(start, 300), { once: true });
  }

  // ── Demo section ────────────────────────────────────────────────────────
  const lab = document.querySelector("[data-lab]");
  let scene = SCENES[0];
  let labTheme = null;
  let labFrame = null;
  let labStage = null;

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

  function loadLab() {
    if (!labFrame) return;
    labStage.classList.remove("is-live");
    labFrame.src = url(scene.q, labTheme);
  }

  function buildLab() {
    if (!lab) return;
    const scenes = el("div", { class: "lab-scenes", role: "group", "aria-label": L("Senaryolar", "Scenarios") },
      ...SCENES.map((s) => el("button", {
        type: "button", class: "lab-scene", "aria-pressed": String(s === scene),
        onclick: () => { scene = s; buildLab(); loadLab(); },
      }, el("span", { class: `dot dot-${s.dot}`, "aria-hidden": "true" }),
      el("span", {}, document.createTextNode(L(...s.name)), el("small", { text: L(...s.note) })))));
    const themes = el("div", { class: "lab-themes", role: "group", "aria-label": L("Maskot", "Mascot") },
      ...THEMES.map(([id, tr, en]) => el("button", {
        type: "button", class: "lab-theme", "aria-pressed": String((labTheme || theme()) === id),
        onclick: () => { labTheme = id; buildLab(); loadLab(); },
      }, document.createTextNode(L(tr, en)))));
    const side = el("aside", { class: "lab-side" },
      el("h3", { text: L("Senaryo", "Scenario") }), scenes,
      el("h3", { text: L("Maskot", "Mascot") }), themes,
      el("p", { class: "lab-note", text: L("Simülasyon: bilgisayarında komut çalışmaz, veri gönderilmez.", "A simulation: nothing runs on your computer and nothing is sent.") }));
    if (!labStage) {
      labFrame = el("iframe", { class: "stage-frame", title: L("Nöbetçi canlı demo", "Nöbetçi live demo") });
      labStage = el("div", { class: "stage lab-stage" },
        el("div", { class: "stage-bar", "aria-hidden": "true" }, el("i"), el("span", { text: "Nöbetçi" })),
        labFrame,
        el("span", { class: "stage-hint" }, el("span", { class: "live-dot", "aria-hidden": "true" }),
          el("span", { text: L("Tıkla, dene", "Click around") })));
      fit(labStage, labFrame);
      // Load when the section comes near, not with the page.
      new IntersectionObserver(([entry], io) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        loadLab();
      }, { rootMargin: "300px" }).observe(labStage);
    } else {
      labStage.querySelector(".stage-hint span:last-child").textContent = L("Tıkla, dene", "Click around");
      labFrame.title = L("Nöbetçi canlı demo", "Nöbetçi live demo");
    }
    lab.replaceChildren(side, labStage);
  }
  buildLab();

  // The language and the site theme reach the frames too.
  site.onLanguage(() => {
    if (heroFrame?.src) heroFrame.src = url("demo=tour");
    buildLab();
    if (labFrame?.src) loadLab();
  });
  let lastTheme = theme();
  new MutationObserver(() => {
    if (theme() === lastTheme) return;
    lastTheme = theme();
    if (heroFrame?.src) heroFrame.src = url("demo=tour");
    if (!labTheme) { buildLab(); if (labFrame?.src) loadLab(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mascot-theme"] });
})();
