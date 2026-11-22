// The site's mascot: the corner companion, the closing call to action and the
// hero's mascot picker. A mascot also tints the page's accents (home-themes.css).
// The app's own engine draws them when it loaded (website/mascot-engine.ts);
// otherwise the static heads from mascot-themes.js stand in.

(() => {
  const { animals, avatar, gaze, read, save } = window.NobetciThemes;
  const ids = Object.keys(animals);
  const englishNames = { owl: "Owl", wolf: "Wolf", hawk: "Hawk", octopus: "Octopus", lion: "Lion", canary: "Canary", eagle: "Eagle" };
  const english = () => document.documentElement.lang === "en";
  const nameOf = (id) => (english() ? englishNames[id] : animals[id][0]);

  const companion = document.querySelector(".owl-companion");
  const mascot = document.createElement("span");
  mascot.className = "home-mascot";
  companion.append(mascot);
  const ctaHost = document.querySelector("[data-cta-mascot]");
  const pickerRow = document.querySelector(".home-theme");
  const picker = document.getElementById("home-theme-picker");

  let theme = read();
  let greetingTimer;
  // The app's own mascot engine when it loaded: every theme, the owl included, is the animated character.
  const live = window.NobetciEngine?.mount(mascot, theme);
  if (live) {
    companion.classList.add("is-live");
    companion.querySelector(".owl-art")?.remove();
  }
  // The closing call to action shows the same mascot, drawn at the screen's own resolution.
  let ctaLive = null;
  if (ctaHost) {
    ctaLive = window.NobetciEngine?.mount(ctaHost, theme) ?? null;
    ctaHost.classList.toggle("is-live", !!ctaLive);
    ctaHost.closest(".cta")?.querySelector(".button-primary")?.addEventListener("pointerenter", () => ctaLive?.wave());
  }

  // ── The picker: a radio group of heads, arrow keys move the choice ────────
  const choices = ids.map((id) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-choice";
    button.setAttribute("role", "radio");
    button.dataset.theme = id;
    button.append(avatar(id, "idle", false));
    button.addEventListener("click", () => choose(id, true));
    picker?.append(button);
    return button;
  });
  picker?.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const index = ids.indexOf(theme);
    let next = null;
    if (step) next = (index + step + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next == null) return;
    event.preventDefault();
    choose(ids[next], true);
    choices[next].focus();
  });
  if (pickerRow && picker) pickerRow.hidden = false;

  function updateLanguage() {
    for (const button of choices) {
      const name = nameOf(button.dataset.theme);
      button.setAttribute("aria-label", name);
      button.title = name;
    }
    const greeting = english() ? `Say hello to ${nameOf(theme)}` : `${nameOf(theme)} maskotuna selam ver`;
    companion.setAttribute("aria-label", greeting);
    companion.title = greeting;
  }

  function apply(id) {
    clearTimeout(greetingTimer);
    theme = id;
    document.documentElement.dataset.mascotTheme = theme;
    for (const button of choices) {
      const on = button.dataset.theme === theme;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    if (live) live.setTheme(theme);
    else mascot.replaceChildren(avatar(theme, "idle", true));
    if (ctaLive) ctaLive.setTheme(theme);
    else ctaHost?.replaceChildren(avatar(theme, "idle", true));
    updateLanguage();
  }

  function choose(id, remember) {
    if (!Object.hasOwn(animals, id)) return;
    apply(id);
    if (remember) save(theme);
  }

  apply(theme);
  companion.addEventListener("click", () => {
    if (live) {
      live.wave();
      live.emote("happy");
      return;
    }
    if (theme === "owl") return;
    clearTimeout(greetingTimer);
    mascot.replaceChildren(avatar(theme, "greeting", true));
    greetingTimer = setTimeout(() => mascot.replaceChildren(avatar(theme, "idle", true)), 700);
  });
  window.addEventListener("pointermove", (event) => {
    if (live || theme === "owl") return;
    const box = mascot.getBoundingClientRect();
    gaze(mascot, Math.tanh((event.clientX - box.left - box.width / 2) / 180) * 2.3,
      Math.tanh((event.clientY - box.top - box.height / 2) / 160) * 2);
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => live || gaze(mascot, 0, 0));
  new MutationObserver(updateLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.addEventListener("pageshow", () => apply(read()));
})();
