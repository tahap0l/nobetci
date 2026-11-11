(() => {
  const { animals, avatar, gaze, read, save } = window.NobetciThemes;
  const englishNames = ["Owl", "Wolf", "Hawk", "Octopus", "Lion", "Canary", "Eagle"];
  const picker = document.getElementById("home-theme-picker");
  const label = document.getElementById("home-theme-label");
  const companion = document.querySelector(".owl-companion");
  const mascot = document.createElement("span");
  mascot.className = "home-mascot";
  companion.append(mascot);
  let theme = read();
  let greetingTimer;
  // The app's own mascot engine when it loaded: every theme, the owl included, is the animated character.
  const live = window.NobetciEngine?.mount(mascot, theme);
  if (live) {
    companion.classList.add("is-live");
    companion.querySelector(".owl-art")?.remove();
  }

  for (const id of Object.keys(animals)) {
    const option = document.createElement("option");
    option.value = id;
    picker.append(option);
  }

  function updateLanguage() {
    const english = document.documentElement.lang === "en";
    label.textContent = english ? "Site theme" : "Site teması";
    for (const [index, option] of Array.from(picker.options).entries()) {
      option.textContent = english ? englishNames[index] : animals[option.value][0];
    }
    const name = picker.selectedOptions[0].textContent;
    const greeting = english ? `Say hello to ${name}` : `${name} maskotuna selam ver`;
    companion.setAttribute("aria-label", greeting);
    companion.title = greeting;
  }

  function apply(id) {
    clearTimeout(greetingTimer);
    theme = id;
    picker.value = theme;
    document.documentElement.dataset.mascotTheme = theme;
    if (live) live.setTheme(theme);
    else mascot.replaceChildren(avatar(theme, "idle", true));
    updateLanguage();
  }

  apply(theme);
  picker.addEventListener("change", () => {
    apply(picker.value);
    save(theme);
  });
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
