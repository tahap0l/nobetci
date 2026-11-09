const { animals, avatar, read, save } = window.NobetciThemes;
const byId = (id) => document.getElementById(id);
const stage = byId("stage");
const mascot = byId("mascot");
const send = byId("send");
const deny = byId("deny");
const allow = byId("allow");
let theme = read();

function selectTheme(id) {
  theme = id;
  document.body.dataset.theme = theme;
  for (const button of byId("themes").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  }
  mascot.replaceChildren(avatar(theme, stage.dataset.state));
  save(theme);
}
for (const [id, [name]] of Object.entries(animals)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme";
  button.dataset.theme = id;
  button.append(avatar(id), document.createTextNode(name));
  button.addEventListener("click", () => selectTheme(id));
  byId("themes").append(button);
}
selectTheme(theme);

function show(state, badge, heading, detail) {
  const pending = state === "pending";
  stage.dataset.state = state;
  mascot.replaceChildren(avatar(theme, state));
  byId("badge").textContent = badge;
  byId("heading").textContent = heading;
  byId("detail").textContent = detail;
  byId("command").hidden = state === "idle";
  byId("status").textContent = heading + ". " + detail;
  send.hidden = pending;
  deny.hidden = allow.hidden = !pending;
  if (!pending) send.textContent = "Yeni istek gönder →";
  (pending ? deny : send).focus();
}
send.addEventListener("click", () => show("pending", "Düşük risk", "İzin isteği geldi", "Claude Code değişen dosyaları listelemek istiyor."));
allow.addEventListener("click", () => show("allowed", "Onaylandı", "İzin verildi", "Simülasyonda Claude Code komutu çalıştırabilir."));
deny.addEventListener("click", () => show("denied", "Reddedildi", "İstek durduruldu", "Simülasyonda Claude Code bu komutu çalıştırmaz."));

window.addEventListener("pageshow", () => selectTheme(read()));
