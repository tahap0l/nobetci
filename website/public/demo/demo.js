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
  byId("widgets").hidden = pending;
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

const music = byId("music");
music.addEventListener("click", () => {
  const playing = music.getAttribute("aria-pressed") !== "true";
  music.setAttribute("aria-pressed", String(playing));
  music.setAttribute("aria-label", playing ? "Örnek oynatmayı duraklat" : "Örnek oynatmayı başlat");
  music.textContent = playing ? "Ⅱ" : "▶";
});
function gaze(x, y) {
  for (const eye of mascot.querySelectorAll("[data-demo-pupil]")) {
    eye.setAttribute("transform", `translate(${x} ${y})`);
  }
}
stage.addEventListener("pointermove", (event) => {
  if (stage.dataset.state === "pending") return;
  const box = mascot.getBoundingClientRect();
  gaze(Math.tanh((event.clientX - box.left - box.width / 2) / 125) * 2.8,
    Math.tanh((event.clientY - box.top - box.height / 2) / 100) * 2.2);
});
stage.addEventListener("pointerleave", () => {
  if (stage.dataset.state !== "pending") gaze(0, 0);
});
