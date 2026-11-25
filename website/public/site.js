// Nobi website: the language button, navigation, scroll reveals and the small
// motions. Plain script, no build step. Every string is in i18n.js, which also
// chose the visitor's language before the page was painted.

const root = document.documentElement;
const I18N = window.NobiI18n;
const BASE = I18N?.base ?? document.querySelector('meta[name="nobi-base"]')?.content ?? "/";
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// ── Language ────────────────────────────────────────────────────────────────
let language = I18N?.lang ?? root.lang ?? "tr";
const listeners = new Set();
const t = (key) => (I18N ? I18N.t(language, key) : key);
window.NobiSite = {
  base: BASE,
  lang: () => language,
  t,
  onLanguage: (fn) => listeners.add(fn),
};

function labelToggles() {
  for (const toggle of document.querySelectorAll("[data-language-toggle]")) {
    const other = language === "tr" ? "en" : "tr";
    toggle.textContent = other.toUpperCase();
    toggle.setAttribute("lang", other);
    toggle.setAttribute("aria-label", t("langLabel"));
  }
}

function setLanguage(next, remember = false) {
  language = next;
  root.lang = next;
  I18N?.apply(next);
  labelToggles();
  if (remember) {
    try { localStorage.setItem("nobi-lang", next); } catch { /* optional */ }
  }
  labelDownload();
  syncMenu();
  for (const fn of listeners) fn(next);
}

// ── Download button: name the visitor's system ──────────────────────────────
function detectOs() {
  const platform = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""}`;
  const all = `${platform} ${navigator.userAgent}`.toLowerCase();
  // Phones, tablets and Chromebooks can't run the app: no system is named.
  if (navigator.userAgentData?.mobile || /android|iphone|ipad|ipod|cros/.test(all)) return null;
  // iPadOS asks for desktop pages as a Mac; its touch screen gives it away.
  if (all.includes("mac") && navigator.maxTouchPoints > 1) return null;
  if (all.includes("win")) return "windows";
  if (all.includes("mac")) return "mac";
  // The Linux packages are x86-64 only.
  if (/linux|x11/.test(all)) return /aarch64|armv|arm64/.test(all) ? null : "linux";
  return null;
}
let OS = detectOs();
const OS_NAMES = { windows: "Windows", mac: "macOS", linux: "Linux" };
function labelDownload() {
  const label = document.querySelector("[data-os-label]");
  if (label) label.textContent = OS ? t("downloadFor").replace("{os}", OS_NAMES[OS]) : t("download");
  for (const card of document.querySelectorAll(".os-card")) card.classList.toggle("is-yours", card.dataset.os === OS);
}
// Browsers that report a reduced user agent still tell the architecture when asked.
if (OS === "linux") {
  navigator.userAgentData?.getHighEntropyValues?.(["architecture"]).then(({ architecture }) => {
    if (architecture === "arm") {
      OS = null;
      labelDownload();
    }
  }).catch(() => {});
}

// ── Header, menu ────────────────────────────────────────────────────────────
const header = document.querySelector(".site-header");
const onScroll = () => header?.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav-links");
const menuOpen = () => !!nav?.classList.contains("is-open");
function syncMenu() {
  if (!menuButton) return;
  const open = menuOpen();
  menuButton.setAttribute("aria-expanded", String(open));
  const label = menuButton.querySelector("[data-menu-label]");
  if (label) label.textContent = t(open ? "menuClose" : "menu");
}
function setMenu(open) {
  if (!nav) return;
  nav.classList.toggle("is-open", open);
  syncMenu();
}
menuButton?.addEventListener("click", () => setMenu(!menuOpen()));
nav?.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !menuOpen()) return;
  setMenu(false);
  menuButton?.focus();
});
// A tap anywhere else closes it, as does growing past the phone layout.
document.addEventListener("pointerdown", (event) => {
  if (!menuOpen() || !(event.target instanceof Node)) return;
  if (nav.contains(event.target) || menuButton?.contains(event.target)) return;
  setMenu(false);
});
matchMedia("(min-width: 901px)").addEventListener("change", (event) => {
  if (event.matches) setMenu(false);
});
for (const toggle of document.querySelectorAll("[data-language-toggle]")) {
  toggle.addEventListener("click", () => setLanguage(language === "tr" ? "en" : "tr", true));
}

// ── Reveal on scroll, with a small stagger among siblings ───────────────────
// i18n.js hid these blocks before the first paint (the `js` class). Blocks
// already on screen come in at once; the rest as they scroll into view.
const revealed = [...document.querySelectorAll(".reveal")];
if (!root.classList.contains("js") || reduced.matches || !("IntersectionObserver" in window)) {
  revealed.forEach((el) => el.classList.add("is-in"));
} else {
  const groups = new Map();
  revealed.forEach((el) => {
    const n = groups.get(el.parentElement) ?? 0;
    groups.set(el.parentElement, n + 1);
    el.style.setProperty("--d", `${Math.min(n, 6) * 0.07}s`);
  });
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
  revealed.forEach((el) => {
    // 26 px: the offset the block waits at (styles.css, .js .reveal).
    if (el.getBoundingClientRect().top - 26 < innerHeight) el.classList.add("is-in");
    else io.observe(el);
  });
}

// ── Tiles: a light that follows the pointer ─────────────────────────────────
document.querySelectorAll(".tile").forEach((tile) => {
  tile.addEventListener("pointermove", (event) => {
    const box = tile.getBoundingClientRect();
    tile.style.setProperty("--mx", `${event.clientX - box.left}px`);
    tile.style.setProperty("--my", `${event.clientY - box.top}px`);
  }, { passive: true });
});

// ── Card carousel ───────────────────────────────────────────────────────────
const carousel = document.querySelector("[data-carousel]");
const dots = document.querySelectorAll("[data-carousel-dots] button");
if (carousel && dots.length) {
  const slides = carousel.querySelectorAll("img");
  let index = 0;
  let timer;
  const show = (i) => {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle("on", k === index));
    dots.forEach((d, k) => d.setAttribute("aria-pressed", String(k === index)));
  };
  const play = () => {
    clearInterval(timer);
    if (!reduced.matches) timer = setInterval(() => show(index + 1), 3600);
  };
  dots.forEach((dot, i) => dot.addEventListener("click", () => { show(i); play(); }));
  // Only turn while it is on screen.
  new IntersectionObserver(([entry]) => (entry.isIntersecting ? play() : clearInterval(timer))).observe(carousel);
}

// ── Steps: the line fills as the section comes into view ────────────────────
const steps = document.querySelector("[data-steps]");
if (steps) {
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) steps.style.setProperty("--progress", "1");
  }, { threshold: 0.4 }).observe(steps);
}

// ── The fake menu bar's clock ───────────────────────────────────────────────
const clock = document.querySelector("[data-clock]");
if (clock) {
  const tick = () => {
    clock.textContent = new Intl.DateTimeFormat(language, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
  };
  tick();
  setInterval(tick, 30_000);
  listeners.add(tick);
}

// ── Mascot companion ────────────────────────────────────────────────────────
// It steps aside while a live island (the hero's or the demo's, each with its
// own mascot) is on screen. Where the window has no free margin for it, it
// also ducks out while the page scrolls down and comes back on the way up, so
// it never sits on the text being read.
const owl = document.querySelector(".owl-companion");
if (owl) {
  const hero = document.querySelector(".hero");
  const lab = document.querySelector("[data-lab]");
  // Below this width the corner overlaps the content column (styles.css, .container).
  const narrow = matchMedia("(max-width: 1379px)");
  const showing = new Map();
  let islandShown = !!hero;
  let ducked = false;
  let hideTimer = 0;
  const update = () => {
    const away = islandShown || ducked;
    if (away === owl.classList.contains("is-away") && owl.hidden === away) return;
    clearTimeout(hideTimer);
    if (away) {
      owl.classList.add("is-away");
      // Out of the tab order and the accessibility tree once it has faded.
      hideTimer = setTimeout(() => { owl.hidden = true; }, 320);
    } else {
      owl.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => owl.classList.remove("is-away")));
    }
  };
  const watched = [hero, lab].filter(Boolean);
  if (watched.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // The hero counts while a good part of it shows; the demo while any of it does.
        showing.set(entry.target, entry.isIntersecting && (entry.target !== hero || entry.intersectionRatio >= 0.3));
      }
      islandShown = [...showing.values()].some(Boolean);
      update();
    }, { threshold: [0, 0.3, 0.6], rootMargin: "-60px 0px -60px 0px" });
    watched.forEach((target) => io.observe(target));
  } else {
    islandShown = false;
  }
  let lastY = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    if (!narrow.matches) ducked = false;
    else if (y > lastY + 8) ducked = true;
    else if (y < lastY - 8) ducked = false;
    // At the very end there is room for it under the footer.
    if (innerHeight + y >= root.scrollHeight - 4) ducked = false;
    lastY = y;
    update();
  }, { passive: true });
  update();

  // The drawn owl (when the mascot engine did not load): its head follows the pointer.
  const owlHead = owl.querySelector(".owl-head");
  const pupils = owl.querySelectorAll("[data-owl-pupil]");
  if (owlHead && pupils.length) {
    addEventListener("pointermove", (event) => {
      if (reduced.matches || (root.dataset.mascotTheme ?? "owl") !== "owl") return;
      const box = owl.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - box.left - box.width / 2) / (innerWidth * 0.38)));
      const y = Math.max(-1, Math.min(1, (event.clientY - box.top - box.height / 2) / (innerHeight * 0.38)));
      owlHead.style.transform = `rotate(${x * 10}deg) translateY(${y * 1.5}px)`;
      pupils.forEach((p) => { p.style.transform = `translate(${x * 2.7}px, ${y * 2.4}px)`; });
    }, { passive: true });
    owl.addEventListener("click", () => {
      if (reduced.matches || (root.dataset.mascotTheme ?? "owl") !== "owl") return;
      owl.classList.remove("is-spinning");
      void owl.offsetWidth;
      owl.classList.add("is-spinning");
    });
    owlHead.addEventListener("animationend", () => owl.classList.remove("is-spinning"));
  }
}

setLanguage(language);
