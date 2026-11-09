(() => {
  const { animals, avatar, read, save } = window.NobetciThemes;
  const englishNames = ["Owl", "Wolf", "Hawk", "Octopus", "Lion", "Canary", "Eagle"];
  const picker = document.getElementById("home-theme-picker");
  const label = document.getElementById("home-theme-label");
  const companion = document.querySelector(".owl-companion");
  const mascot = document.createElement("span");
  mascot.className = "home-mascot";
  companion.append(mascot);
  let theme = read();

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
    theme = id;
    picker.value = theme;
    document.documentElement.dataset.mascotTheme = theme;
    mascot.replaceChildren(avatar(theme));
    updateLanguage();
  }

  apply(theme);
  picker.addEventListener("change", () => {
    apply(picker.value);
    save(theme);
  });
  companion.addEventListener("click", () => {
    if (theme !== "owl" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      mascot.getAnimations().forEach((animation) => animation.cancel());
      mascot.animate([{ transform: "none" }, { transform: "translateY(-7px) rotate(-14deg)" }, { transform: "none" }], { duration: 430 });
    }
  });
  new MutationObserver(updateLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.addEventListener("pageshow", () => apply(read()));
})();
