// Nöbetçi website: language, navigation, scroll reveals and the small motions.
// Plain script, no build step. Every string the page shows is in COPY below,
// in Turkish and English; the HTML carries the Turkish text as the fallback.

const COPY = {
  tr: {
    skip: "İçeriğe atla", menu: "Menü", navMain: "Ana gezinme", navFeatures: "Özellikler", navNew: "Yenilikler", navDemo: "Canlı demo", navDownload: "İndir", navFaq: "SSS",
    pill: "Sesle yazma, ajanda, sistem kartı",
    heroTitle: "Yapay zekâ kod yazsın.<br /><em>Son karar sende.</em>",
    heroText: "Nöbetçi, Claude Code oturumlarını ekranının üstündeki küçük bir adada izler. Bir izin isteği geldiğinde komutu ve riskini tek bakışta gösterir; onaylamak ya da reddetmek sana kalır.",
    download: "Ücretsiz indir", downloadFor: "{os} için indir", tryDemo: "Canlı demoyu dene",
    meta1: "Ücretsiz ve açık kaynak", meta2: "Hesap yok, telemetri yok", meta3: "Windows · macOS · Linux",
    barFile: "Dosya", barView: "Görünüm", frameTitle: "Nöbetçi adası, canlı", stageHint: "Canlı · gerçek uygulama arayüzü",
    chip1: "Karar sende", chip1s: "Hiçbir istek kendiliğinden onaylanmaz", chip2: "Risk motoru", chip2s: "Her komut puanlanır ve açıklanır",
    stripLabel: "Uyumlu araçlar", stripLead: "Şunlarla çalışır:", stripDesktop: "Claude masaüstü (Code)",
    featuresEyebrow: "Kontrolü elinde tut", featuresTitle: "Ajan çalışırken sen de <em>ne olduğunu bil.</em>",
    featuresIntro: "Terminalde gözden kaçabilecek istekler adada, anlaşılır bir dille önüne gelir. Arada da ada senin için çalışır.",
    f1Title: "Riski ve nedenini anla",
    f1Text: "İzin kartı komutun, dosya yolunun ya da bağlantının tamamını gösterir; riskli parçaları işaretler, nedenlerini sıralar. Yüksek riskte izin vermek için düğmeyi basılı tutman gerekir ve yalnızca gerçek bir fare tıklaması sayılır.",
    f2Title: "Her oturum tek yerde", f2Text: "Terminal, VS Code ya da Claude masaüstü uygulaması: hangisinde çalışırsa çalışsın, her oturumun durumu ve son adımı adada.",
    f2a: "Çalışıyor, düşünüyor, onay bekliyor, bitti", f2b: "Tek tıkla doğru pencereye git", f2c: "Bitince küçük bir bildirim",
    f3Title: "Adada bir asistan",
    f3Text: "<span class=\"kbd\">Ctrl</span> <span class=\"kbd\">Alt</span> <span class=\"kbd\">Space</span> ile yaz ya da 🎙 ile konuş; mesajın ChatGPT, Claude, Gemini, Perplexity ve diğerlerinde açılsın. Uygulama yüklüyse doğrudan orada. Ne soracağını bilmiyorsan hazır promptlar yol gösterir.",
    f4Title: "Beş kart, tek ada", f4Text: "Müzik ve odak sayacı, ajanda, takvim, animasyonlu hava durumu ve canlı CPU · RAM · GPU. Kartlar yalnızca ekrandayken çalışır.",
    cWeather: "Hava", cAgenda: "Ajanda", cCalendar: "Takvim", cSystem: "Sistem",
    f5Title: "Mesaj Atölyesi", f5Text: "Ajana göndermeden önce mesajını düzelt ve netleştir. Yerel Ollama ya da seçersen OpenAI; sonucu inceleyip kendin kopyalarsın.",
    f6Title: "Yedi maskot, hepsi canlı",
    f6Text: "Baykuş, kurt, şahin, ahtapot, aslan, kanarya ve kartal. Onaylayınca sevinir, reddedince kaşlarını çatar; istersen masaüstünde serbestçe dolaşır, boyunu sen seçersin.",
    altCritical: "Kritik riskli bir komutu, riskli bölümlerini ve dört bulguyu gösteren onay kartı",
    altAssistant: "Hazır prompt kütüphanesi açık asistan", altWeather: "Hava durumu kartı", altAgenda: "Ajanda kartı",
    altCalendar: "Takvim kartı", altSystem: "Sistem kartı", altMascots: "Yedi maskot yan yana, her biri farklı bir ruh hâlinde",
    altSecurity: "Ayarlar penceresinde güvenlik sayfası",
    newEyebrow: "Yenilikler", newTitle: "Her sürümde <em>biraz daha yetenekli.</em>",
    d231: "15 Kasım 2026", d230: "14 Kasım 2026", d220: "14 Kasım 2026",
    n231a: "Sesle yazma ve 20'ye yakın hazır prompt", n231b: "Yüklü AI uygulaması varsa mesaj orada açılır",
    n231c: "Ajanda ve hatırlatıcılar, yeni takvim, animasyonlu hava durumu", n231d: "CPU · RAM · GPU kartı, ayarlanabilir odak süresi",
    n231e: "Adada daha akıcı açılış animasyonları",
    n230a: "Linux desteği (.deb ve AppImage), macOS betadan çıktı", n230b: "Adada asistan: ChatGPT, Claude, Gemini, Perplexity ve fazlası",
    n230c: "İleri sarılabilen yeni medya kartı, üç sistemde", n230d: "Yenilenen ayarlar penceresi",
    n220a: "Masaüstünde serbestçe dolaşan maskot", n220b: "Onay ve ret için animasyonlu tepkiler",
    demoEyebrow: "Canlı demo", demoTitle: "İndirmeden önce <em>bir dene.</em>",
    demoIntro: "Aşağıdaki ada, uygulamanın gerçek arayüzü. Bir senaryo seç, kartlara tıkla, onay kartında düğmeleri dene; bilgisayarında hiçbir şey çalışmaz.",
    howEyebrow: "Üç adımda", howTitle: "Gör. Anla.<br /><em>Sonra karar ver.</em>",
    s1: "İstek ekrana gelir", s1t: "Claude Code bir işlem için izin istediğinde ada açılır ve isteği önüne getirir.",
    s2: "Neyi çalıştıracağını incele", s2t: "Komutun tamamı, risk seviyesi, nedenleri ve şüpheli parçalar tek kartta.",
    s3: "Kararını ver", s3t: "İzin ver, reddet ya da terminale bırak. Nöbetçi kapalıysa ajan hiç beklemeden çalışmaya devam eder.",
    howCaption: "Otomatik izin tavanı, basılı tutma süreleri ve gerçek tıklama koruması senin elinde.",
    dlEyebrow: "İndir", dlTitle: "Nöbetçi <em>nöbete hazır.</em>", dlIntro: "Ücretsiz indir, kurulum sihirbazıyla Claude Code'a bağla, ilk izin isteğinde kararını ver.",
    yours: "Senin sistemin", get: "İndir",
    winReq: "Windows 10 ve 11, 64 bit. Kurulum sihirbazı her şeyi ayarlar.",
    macReq: "macOS 11 ve üstü, Apple Silicon ve Intel tek pakette.",
    linuxReq: "x86-64, X11 ya da Wayland. Debian ve Ubuntu için .deb, her dağıtım için AppImage.",
    dlNote: "Her sürümün yanında SHA256SUMS.txt var; indirdiğini doğrulayabilirsin. Kaynak kod MIT lisanslı.",
    faqEyebrow: "Sık sorulanlar", faqTitle: "Merak ettiklerin",
    q1: "Nöbetçi kapalıysa ajanım takılır mı?", a1: "Hayır. Uygulama kapalıysa köprü hiçbir şey yapmadan çıkar ve Claude Code her zamanki gibi terminalde sorar. Açıkken bile bir isteğe yalnızca belirli bir süre bekler.",
    q2: "Verilerim bir yere gönderiliyor mu?", a2: "Hayır. Hesap, telemetri ya da analiz yok. Ağa yalnızca senin açtığın şeyler çıkar: Mesaj Atölyesi'nde seçtiğin sağlayıcı ve şehir seçtiysen hava durumu.",
    q3: "Yüksek riskli bir komut kendiliğinden onaylanabilir mi?", a3: "Hayır. Kurallar, güvenilen projeler ve oturum izinleri en fazla orta riske kadar otomatik izin verebilir. Yüksek ve kritik istekler her zaman basılı tutmayla, gerçek bir tıklamayla onaylanır.",
    q4: "Claude masaüstü uygulamasıyla da çalışıyor mu?", a4: "Evet; uygulamanın Code sekmesindeki Claude Code oturumları terminaldekilerle aynı şekilde izlenir ve adada ayrıca etiketlenir. Normal sohbet bölümü izlenemez.",
    q5: "Ücretli mi?", a5: "Hayır. Nöbetçi ücretsiz ve MIT lisanslı açık kaynak bir projedir.",
    ctaTitle: "Yapay zekâ çalışsın, <em>sen izle.</em>", ctaText: "Birkaç dakikada kur, ilk izin isteğinde farkı gör.",
    footerLine: "Dikkatli ajanlar için küçük bir baykuş.", footerNav: "Alt gezinme", footerPrivacy: "Gizlilik", footerSigning: "Kod imzalama politikası", dlSigning: "Kod imzalama politikası", footerChanges: "Sürüm notları",
    footerLicense: "MIT lisansı", footerContact: "İletişim", langLabel: "Switch language to English",
    owlLabel: "Baykuşun başını döndür", owlHint: "Tıkla, selam versin",
  },
  en: {
    skip: "Skip to content", menu: "Menu", navMain: "Main navigation", navFeatures: "Features", navNew: "What's new", navDemo: "Live demo", navDownload: "Download", navFaq: "FAQ",
    pill: "Voice input, agenda, system card",
    heroTitle: "Let AI write the code.<br /><em>You make the call.</em>",
    heroText: "Nöbetçi watches your Claude Code sessions from a small island at the top of your screen. When a permission request arrives, it shows the command and its risk at a glance — allowing or denying it is up to you.",
    download: "Download free", downloadFor: "Download for {os}", tryDemo: "Try the live demo",
    meta1: "Free and open source", meta2: "No account, no telemetry", meta3: "Windows · macOS · Linux",
    barFile: "File", barView: "View", frameTitle: "The Nöbetçi island, live", stageHint: "Live · the real app's interface",
    chip1: "Your call", chip1s: "Nothing is approved on its own", chip2: "Risk engine", chip2s: "Every command scored and explained",
    stripLabel: "Works with", stripLead: "Works with:", stripDesktop: "Claude desktop (Code)",
    featuresEyebrow: "Stay in control", featuresTitle: "Know what's happening while your <em>agent works.</em>",
    featuresIntro: "Requests that could get lost in a terminal reach you on the island, in plain words. In between, the island works for you.",
    f1Title: "Understand the risk, and why",
    f1Text: "The approval card shows the whole command, file path or URL, marks the risky parts and lists the reasons. High-risk requests need a press and hold — and only a real mouse click counts.",
    f2Title: "Every session in one place", f2Text: "Terminal, VS Code or the Claude desktop app: wherever a session runs, its state and last step are on the island.",
    f2a: "Working, thinking, waiting, done", f2b: "Jump to the right window in one click", f2c: "A small notice when it finishes",
    f3Title: "An assistant on the island",
    f3Text: "Type with <span class=\"kbd\">Ctrl</span> <span class=\"kbd\">Alt</span> <span class=\"kbd\">Space</span> or speak with 🎙, and your message opens in ChatGPT, Claude, Gemini, Perplexity and more — in the desktop app when it's installed. Not sure what to ask? Ready-made prompts show the way.",
    f4Title: "Five cards, one island", f4Text: "Music and a focus timer, an agenda, a calendar, animated weather and live CPU · RAM · GPU. Cards only run while they're on screen.",
    cWeather: "Weather", cAgenda: "Agenda", cCalendar: "Calendar", cSystem: "System",
    f5Title: "Prompt Studio", f5Text: "Fix and sharpen a message before it goes to your agent. Local Ollama, or OpenAI if you choose; you review and copy the result yourself.",
    f6Title: "Seven mascots, all alive",
    f6Text: "Owl, wolf, hawk, octopus, lion, canary and eagle. They cheer when you approve and frown when you deny; one can roam your desktop too, at the size you like.",
    altCritical: "An approval card for a critical command, with its risky parts and four findings",
    altAssistant: "The assistant with its prompt library open", altWeather: "The weather card", altAgenda: "The agenda card",
    altCalendar: "The calendar card", altSystem: "The system card", altMascots: "Seven mascots side by side, each in a different mood",
    altSecurity: "The Safety page in the settings window",
    newEyebrow: "What's new", newTitle: "A little more capable <em>with every release.</em>",
    d231: "15 November 2026", d230: "14 November 2026", d220: "14 November 2026",
    n231a: "Voice input and about 20 ready-made prompts", n231b: "Messages open in installed AI apps",
    n231c: "Agenda with reminders, a new calendar, animated weather", n231d: "CPU · RAM · GPU card, adjustable focus length",
    n231e: "Smoother island animations",
    n230a: "Linux support (.deb and AppImage); macOS out of beta", n230b: "An assistant on the island: ChatGPT, Claude, Gemini, Perplexity and more",
    n230c: "A new seekable media card on all three systems", n230d: "A refreshed settings window",
    n220a: "A mascot that roams your desktop", n220b: "Animated reactions to approvals and denials",
    demoEyebrow: "Live demo", demoTitle: "Try it <em>before you download.</em>",
    demoIntro: "The island below is the app's real interface. Pick a scenario, click the cards, try the buttons on an approval card — nothing runs on your computer.",
    howEyebrow: "Three steps", howTitle: "See it. Understand it.<br /><em>Then decide.</em>",
    s1: "A request appears", s1t: "When Claude Code asks permission for an action, the island opens and brings it to you.",
    s2: "Review what will run", s2t: "The whole command, its risk level, the reasons and any suspicious parts on one card.",
    s3: "Make your decision", s3t: "Allow, deny or hand it back to the terminal. If Nöbetçi is closed, your agent carries on without waiting.",
    howCaption: "The auto-allow ceiling, hold times and the real-click guard are yours to set.",
    dlEyebrow: "Download", dlTitle: "Nöbetçi is <em>ready to keep watch.</em>", dlIntro: "Download for free, connect Claude Code with the setup wizard, and decide on its first request.",
    yours: "Your system", get: "Download",
    winReq: "Windows 10 and 11, 64-bit. The setup wizard sets everything up.",
    macReq: "macOS 11 or later, Apple silicon and Intel in one package.",
    linuxReq: "x86-64, X11 or Wayland. A .deb for Debian and Ubuntu, an AppImage for any distribution.",
    dlNote: "Every release comes with SHA256SUMS.txt so you can check your download. The source is MIT licensed.",
    faqEyebrow: "Questions", faqTitle: "Things people ask",
    q1: "Does my agent get stuck if Nöbetçi is closed?", a1: "No. If the app is closed, the relay exits without doing anything and Claude Code asks in the terminal as usual. Even when it's open, it waits only so long for an answer.",
    q2: "Is my data sent anywhere?", a2: "No. No account, no telemetry, no analytics. Only what you switch on goes online: the provider you pick in Prompt Studio, and the weather if you choose a city.",
    q3: "Can a high-risk command be approved automatically?", a3: "No. Rules, trusted projects and session grants can auto-allow up to medium risk at most. High and critical requests always need a press and hold with a real click.",
    q4: "Does it work with the Claude desktop app?", a4: "Yes: Claude Code sessions in the app's Code tab are watched like terminal ones and labelled on the island. The regular chat isn't watched.",
    q5: "Does it cost anything?", a5: "No. Nöbetçi is free, open source and MIT licensed.",
    ctaTitle: "Let AI work. <em>You keep watch.</em>", ctaText: "Set it up in a few minutes and see the difference at the first permission request.",
    footerLine: "A little owl for careful agents.", footerNav: "Footer", footerPrivacy: "Privacy", footerSigning: "Code signing policy", dlSigning: "Code signing policy", footerChanges: "Release notes",
    footerLicense: "MIT license", footerContact: "Contact", langLabel: "Türkçeye geç",
    owlLabel: "Make the owl turn its head", owlHint: "Click to say hello",
  },
};

const root = document.documentElement;
root.classList.add("js");
const BASE = document.querySelector('meta[name="nobetci-base"]')?.content || "/";
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// ── Language ────────────────────────────────────────────────────────────────
function initialLanguage() {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked === "tr" || asked === "en") return asked;
  try {
    const saved = localStorage.getItem("nobetci-lang");
    if (saved === "tr" || saved === "en") return saved;
  } catch { /* storage is optional */ }
  return (navigator.language || "tr").toLowerCase().startsWith("tr") ? "tr" : "en";
}

let language = "tr";
const listeners = new Set();
window.NobetciSite = {
  base: BASE,
  lang: () => language,
  t: (key) => COPY[language][key] ?? COPY.tr[key] ?? key,
  onLanguage: (fn) => listeners.add(fn),
};

function setLanguage(next, remember = false) {
  language = next;
  root.lang = next;
  const dict = COPY[next];
  // Our own strings; a few carry <em>, <br> or <span class="kbd">.
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const text = dict[el.dataset.i18n];
    if (text == null) return;
    if (/[<&]/.test(text)) el.innerHTML = text;
    else el.textContent = text;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const text = dict[el.dataset.i18nAria];
    if (text) el.setAttribute("aria-label", text);
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    const text = dict[el.dataset.i18nAlt];
    if (text) el.alt = text;
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const text = dict[el.dataset.i18nTitle];
    if (text) el.title = text;
  });
  // Screenshots in the page's language.
  document.querySelectorAll("img[data-shot]").forEach((img) => {
    img.src = `${BASE}shots/${next}/${img.dataset.shot}.webp`;
  });
  const toggle = document.querySelector("[data-language-toggle]");
  if (toggle) {
    toggle.textContent = next === "tr" ? "EN" : "TR";
    toggle.setAttribute("aria-label", dict.langLabel);
  }
  if (remember) {
    try { localStorage.setItem("nobetci-lang", next); } catch { /* optional */ }
  }
  labelDownload();
  for (const fn of listeners) fn(next);
}

// ── Download button: name the visitor's system ──────────────────────────────
function detectOs() {
  const ua = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (/android|iphone|ipad/.test(ua)) return null;
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return null;
}
const OS = detectOs();
const OS_NAMES = { windows: "Windows", mac: "macOS", linux: "Linux" };
function labelDownload() {
  const label = document.querySelector("[data-os-label]");
  if (label && OS) label.textContent = COPY[language].downloadFor.replace("{os}", OS_NAMES[OS]);
}
if (OS) document.querySelector(`.os-card[data-os="${OS}"]`)?.classList.add("is-yours");

// ── Header, menu ────────────────────────────────────────────────────────────
const header = document.querySelector(".site-header");
const onScroll = () => header?.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav-links");
menuButton?.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(open));
});
nav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    nav.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }
});
document.querySelector("[data-language-toggle]")?.addEventListener("click", () => setLanguage(language === "tr" ? "en" : "tr", true));

// ── Reveal on scroll, with a small stagger among siblings ───────────────────
const revealed = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !reduced.matches) {
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
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  revealed.forEach((el) => io.observe(el));
} else {
  revealed.forEach((el) => el.classList.add("is-in"));
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

// ── Owl companion ───────────────────────────────────────────────────────────
const owl = document.querySelector(".owl-companion");
const owlHead = owl?.querySelector(".owl-head");
const pupils = owl?.querySelectorAll("[data-owl-pupil]");
if (owl && owlHead && pupils?.length) {
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

setLanguage(initialLanguage());
