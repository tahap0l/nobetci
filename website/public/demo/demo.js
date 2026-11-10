const { animals, avatar, gaze, read, save } = window.NobetciThemes;
const byId = (id) => document.getElementById(id);
const stage = byId("stage");
const mascot = byId("mascot");
const send = byId("send");
const sendRisky = byId("send-risky");
const deny = byId("deny");
const allow = byId("allow");
const mascotSignal = byId("mascot-signal");
const signals = { pending: "?", danger: "!", allowed: "✓", denied: "×" };
let theme = read();

function selectTheme(id) {
  theme = id;
  document.body.dataset.theme = theme;
  for (const button of byId("themes").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  }
  mascot.replaceChildren(avatar(theme, stage.dataset.state, true));
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
  const pending = state === "pending" || state === "danger";
  stage.dataset.state = state;
  mascot.replaceChildren(avatar(theme, state, true));
  mascotSignal.textContent = signals[state] ?? "";
  mascotSignal.hidden = !signals[state];
  byId("badge").textContent = badge;
  byId("heading").textContent = heading;
  byId("detail").textContent = detail;
  byId("command").hidden = state === "idle";
  byId("widgets").hidden = pending;
  byId("status").textContent = heading + ". " + detail;
  send.hidden = sendRisky.hidden = pending;
  deny.hidden = allow.hidden = !pending;
  if (!pending) send.textContent = "Yeni istek gönder →";
  (pending ? deny : send).focus();
}
send.addEventListener("click", () => {
  byId("example-command").textContent = "git status --short";
  show("pending", "Düşük risk", "İzin isteği geldi", "Claude Code değişen dosyaları listelemek istiyor.");
});
sendRisky.addEventListener("click", () => {
  byId("example-command").textContent = "git reset --hard HEAD";
  show("danger", "Yüksek risk", "Değişiklikler silinebilir", "Bu komut kaydedilmemiş Git değişikliklerini silebilir. Karar vermeden önce incele.");
});
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
stage.addEventListener("pointermove", (event) => {
  if (stage.dataset.state !== "idle") return;
  const box = mascot.getBoundingClientRect();
  gaze(mascot, Math.tanh((event.clientX - box.left - box.width / 2) / 125) * 2.2,
    Math.tanh((event.clientY - box.top - box.height / 2) / 100) * 2);
});
stage.addEventListener("pointerleave", () => {
  if (stage.dataset.state === "idle") gaze(mascot, 0, 0);
});
