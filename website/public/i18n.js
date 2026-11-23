// Nöbetçi website: every string the pages show, in Turkish and English, and the
// visitor's language decided before the first paint.
//
// Loaded without `defer` at the end of <head> on every page. The HTML carries
// the Turkish text; for an English visitor this script translates each element
// as the parser adds it, so the page is never painted in the wrong language and
// nothing jumps when the language switches. site.js (deferred) does the rest:
// the language button, and the strings that depend on the visitor's system.
// Plain script, no build step. Strings with markup are our own constants.

(() => {
  const COPY = {
    tr: {
      // Page titles and descriptions, by <html data-page>.
      title_home: "Nöbetçi — Son karar sende",
      desc_home: "Nöbetçi, Claude Code'un izin isteklerini ekranının üstündeki bir adada gösterir: komutu ve riskini gör, kararı sen ver. Codex ve Cursor'u da izler. Asistan, ajanda, müzik, hava ve sistem kartlarıyla. Windows, macOS ve Linux için ücretsiz.",
      title_demo: "Nöbetçi · Canlı demo",
      desc_demo: "Nöbetçi'nin gerçek arayüzünü tarayıcında dene: izin kartları, sorular ve planlar, asistan, ajanda, hava ve sistem kartları.",
      title_privacy: "Gizlilik politikası — Nöbetçi",
      desc_privacy: "Nöbetçi'nin gizlilik politikası: yerel kayıtlar, isteğe bağlı yapay zekâ mesaj incelemesi, ada asistanı ve veri tercihlerin.",
      title_signing: "Kod imzalama politikası — Nöbetçi",
      desc_signing: "Nöbetçi'nin kod imzalama politikası: güncel durum, neler imzalanır, sürümler nasıl imzalanır ve ekip rolleri.",
      title_404: "Sayfa bulunamadı — Nöbetçi",
      desc_404: "Aradığın sayfa burada yok.",

      // Shared header and footer.
      skip: "İçeriğe atla", menu: "Menü", menuClose: "Kapat", navMain: "Ana gezinme",
      navFeatures: "Özellikler", navNew: "Yenilikler", navDemo: "Canlı demo", navDownload: "İndir", navFaq: "SSS",
      langLabel: "Switch language to English", homeLabel: "Nöbetçi ana sayfa",
      footerLine: "Dikkatli ajanlar için küçük bir baykuş.", footerNav: "Alt gezinme", footerHome: "Ana sayfa",
      footerPrivacy: "Gizlilik", footerSigning: "Kod imzalama politikası", footerChanges: "Sürüm notları",
      footerLicense: "MIT lisansı", footerContact: "İletişim",
      back: "← Nöbetçi ana sayfasına dön",

      // 404
      nfTitle: "Bu sayfa nöbette değil.",
      nfText: "Aradığın sayfa burada yok; taşınmış ya da kaldırılmış olabilir. Nöbetçi ana sayfasından devam edebilirsin.",
      nfHome: "Ana sayfaya dön", nfDemo: "Canlı demoyu aç",

      // Home: hero
      pill: "Daha keskin risk motoru, daha güvenli onaylar",
      heroTitle: "Yapay zekâ kod yazsın.<br /><em>Son karar sende.</em>",
      heroText: "Nöbetçi, Claude Code oturumlarını (Codex ve Cursor'u da) ekranının üstündeki küçük bir adada izler. Bir izin isteği geldiğinde komutu ve riskini tek bakışta gösterir; onaylamak ya da reddetmek sana kalır.",
      download: "Ücretsiz indir", downloadFor: "{os} için indir", tryDemo: "Canlı demoyu dene",
      meta1: "Ücretsiz ve açık kaynak", meta2: "Hesap yok, telemetri yok", meta3: "Windows · macOS · Linux",
      themeLabel: "Maskot", themeGroup: "Sitenin maskotu ve renkleri",
      barFile: "Dosya", barView: "Görünüm", frameTitle: "Nöbetçi adası, canlı", stageHint: "Canlı · gerçek uygulama arayüzü",
      stagePause: "Durdur", stagePauseLabel: "Turu durdur", stagePlay: "Oynat", stagePlayLabel: "Turu oynat",
      chip1: "Karar sende", chip1s: "Yüksek risk asla kendiliğinden onaylanmaz", chip2: "Risk motoru", chip2s: "Her komut puanlanır ve açıklanır",
      stripLabel: "Uyumlu araçlar", stripLead: "Şunlarla çalışır:", stripDesktop: "Claude masaüstü (Code)",
      stripAssistant: "Asistan mesajını ChatGPT, Gemini, Perplexity ve diğerlerinde açar",

      // Home: features
      featuresEyebrow: "Kontrolü elinde tut", featuresTitle: "Ajan çalışırken sen de <em>ne olduğunu bil.</em>",
      featuresIntro: "Terminalde gözden kaçabilecek istekler adada, anlaşılır bir dille önüne gelir. Arada da ada senin için çalışır.",
      f1Title: "Riski ve nedenini anla",
      f1Text: "İzin kartı komutun, dosya yolunun ya da bağlantının tamamını gösterir; riskli parçaları işaretler, nedenlerini sıralar. Yüksek riskte izin vermek için düğmeyi basılı tutman gerekir ve yalnızca gerçek bir fare tıklaması sayılır; Linux'ta yüksek ve kritik istekler terminalde onaylanır.",
      f2Title: "Her oturum tek yerde",
      f2Text: "Terminal, VS Code ya da Claude masaüstü uygulaması: hangisinde çalışırsa çalışsın, her oturumun durumu ve son adımı adada.",
      f2a: "Çalışıyor, düşünüyor, onay bekliyor, bitti", f2b: "Değişen dosyalar ve farkları", f2c: "Bağlam ve plan limitleri (isteğe bağlı)",
      f2d: "Tek tıkla doğru pencereye git",
      fqTitle: "Sorular ve planlar adada",
      fqText: "Claude çoktan seçmeli bir soru sorduğunda ya da planını onaya sunduğunda kart onu gösterir: cevabı seç ya da kendin yaz, planı onayla ya da notla geri gönder. Birkaç düşük riskli istek bekliyorsa hepsine tek tıkla izin verirsin; orta ve üstü buna hiç girmez.",
      f3Title: "Adada bir asistan",
      f3Text: "<span class=\"kbd\">Ctrl</span> <span class=\"kbd\">Alt</span> <span class=\"kbd\">Space</span> ile yaz ya da 🎙 ile konuş (Windows ve macOS); mesajın ChatGPT, Claude, Gemini, Perplexity ve diğerlerinde açılsın. Uygulama yüklüyse doğrudan orada. Ne soracağını bilmiyorsan hazır promptlar yol gösterir.",
      f4Title: "Beş kart, tek ada", f4Text: "Müzik ve odak sayacı, ajanda, takvim, animasyonlu hava durumu ve canlı CPU · RAM · GPU. Kartlar yalnızca ekrandayken çalışır.",
      cWeather: "Hava", cAgenda: "Ajanda", cCalendar: "Takvim", cSystem: "Sistem",
      f5Title: "Mesaj Atölyesi", f5Text: "Ajana göndermeden önce mesajını düzelt ve netleştir. Yerel Ollama ya da seçersen OpenAI; sonucu inceleyip kendin kopyalarsın.",
      f5Example: "Örnek", f5BeforeTag: "Taslak", f5Before: "login'i düzelt",
      f5AfterTag: "Düzeltilmiş", f5After: "Giriş sayfasındaki XSS açığını bul ve kapat: kullanıcı girdisini kaçışla, bunun için bir test ekle ve neyi değiştirdiğini özetle.",
      f6Title: "Yedi maskot, hepsi canlı",
      f6Text: "Baykuş, kurt, şahin, ahtapot, aslan, kanarya ve kartal. Onaylayınca sevinir, reddedince kaşlarını çatar; istersen masaüstünde serbestçe dolaşır, boyunu sen seçersin.",
      altCritical: "Kritik riskli bir komutu, riskli bölümlerini ve dört bulguyu gösteren onay kartı",
      altSession: "Bir oturumun ayrıntısı: son adımlar, değişen dosyalar ve plan limitleri",
      altQuestion: "Claude'un iki sorusunu seçenekleriyle gösteren soru kartı",
      altAssistant: "Hazır prompt kütüphanesi açık asistan", altWeather: "Hava durumu kartı", altAgenda: "Ajanda kartı",
      altCalendar: "Takvim kartı", altSystem: "Sistem kartı", altMascots: "Yedi maskot yan yana, her biri farklı bir ruh hâlinde",
      altSecurity: "Ayarlar penceresinde güvenlik sayfası",

      // Home: what's new
      newEyebrow: "Yenilikler", newTitle: "Her sürümde <em>biraz daha yetenekli.</em>", newAll: "Tüm sürüm notları →",
      d250: "23 Kasım 2026", d241: "19 Kasım 2026", d240: "19 Kasım 2026", d233: "16–19 Kasım 2026", d231: "15 Kasım 2026", d230: "14 Kasım 2026",
      n250a: "Risk motoru çok daha fazla tehlikeli komutu yakalıyor; gündelik komutlar düşük kalıyor",
      n250b: "Reddetmek Claude'u durdurmuyor; geçmiş her sonucu kaydediyor",
      n250c: "Linux'ta yüksek ve kritik istekler terminalde onaylanıyor",
      n250d: "Windows'ta güncelleme hook'larını koruyor; ada, ayarlar ve maskotlarda çok sayıda düzeltme",
      n241a: "Windows kurulum sihirbazı ve macOS disk görüntüsü için yeni görünüm",
      n241b: "Kurulumda el sallayan, iş bitince sevinen baykuş",
      n240a: "Claude'un çoktan seçmeli sorularını adada cevapla",
      n240b: "Planları adada onayla ya da notla geri gönder",
      n240c: "Bekleyen düşük riskli isteklerin hepsine tek tıkla izin",
      n240d: "Değişen dosyalar ve farkları; isteğe bağlı bağlam ve plan limitleri",
      n233a: "Claude masaüstü uygulamasının izin istekleri de adaya geliyor",
      n233b: "Windows'ta Claude masaüstü uygulaması için hook'lar düzeltildi",
      n231a: "Sesle yazma (Windows ve macOS) ve 20'ye yakın hazır prompt", n231b: "Yüklü AI uygulaması varsa mesaj orada açılır",
      n231c: "Ajanda ve hatırlatıcılar, yeni takvim, animasyonlu hava durumu", n231d: "CPU · RAM · GPU kartı, ayarlanabilir odak süresi",
      n230a: "Linux desteği (.deb ve AppImage), macOS betadan çıktı", n230b: "Adada asistan: ChatGPT, Claude, Gemini, Perplexity ve fazlası",
      n230c: "İleri sarılabilen yeni medya kartı, üç sistemde", n230d: "Yenilenen ayarlar penceresi",

      // Home: live demo, how it works
      demoEyebrow: "Canlı demo", demoTitle: "İndirmeden önce <em>bir dene.</em>",
      demoIntro: "Aşağıdaki ada, uygulamanın gerçek arayüzü. Bir senaryo seç, kartlara tıkla, onay kartında düğmeleri dene; bilgisayarında hiçbir şey çalışmaz.",
      howEyebrow: "Üç adımda", howTitle: "Gör. Anla.<br /><em>Sonra karar ver.</em>",
      s1: "İstek ekrana gelir", s1t: "Claude Code bir işlem için izin istediğinde ada açılır ve isteği önüne getirir.",
      s2: "Neyi çalıştıracağını incele", s2t: "Komutun tamamı, risk seviyesi, nedenleri ve şüpheli parçalar tek kartta.",
      s3: "Kararını ver", s3t: "İzin ver, reddet ya da terminale bırak. Nöbetçi kapalıysa ajan hiç beklemeden çalışmaya devam eder.",
      howCaption: "Otomatik izin tavanı, basılı tutma süreleri ve gerçek tıklama koruması senin elinde.",

      // Home: download
      dlEyebrow: "İndir", dlTitle: "Nöbetçi <em>nöbete hazır.</em>", dlIntro: "Ücretsiz indir, kurulum sihirbazıyla Claude Code'a bağla, ilk izin isteğinde kararını ver.",
      dlLatest: "Son sürüm", yours: "Senin sistemin", get: "İndir",
      winReq: "Windows 10 ve 11, 64 bit. Kurulum sihirbazı her şeyi ayarlar.",
      macReq: "macOS 11 ve üstü, Apple Silicon ve Intel tek pakette.",
      linuxReq: "x86-64; X11 ya da XWayland üzerinden Wayland, pencere bileşikleştiricisi açık. Debian ve Ubuntu için .deb, her dağıtım için AppImage. Yüksek ve kritik istekler terminalde onaylanır.",
      dlNote: "Her sürümün yanında SHA256SUMS.txt var; indirdiğini doğrulayabilirsin. Kaynak kod MIT lisanslı.",
      dlUnsigned: "Windows sürümleri henüz kod imzalı değil (SignPath Foundation'ın ücretsiz imzalama programına başvurduk), bu yüzden SmartScreen uyarı gösterebilir.",
      dlSigning: "Kod imzalama politikası",

      // Home: FAQ, closing
      faqEyebrow: "Sık sorulanlar", faqTitle: "Merak ettiklerin",
      q1: "Nöbetçi kapalıysa ajanım takılır mı?", a1: "Hayır. Uygulama kapalıysa köprü hiçbir şey yapmadan çıkar ve Claude Code her zamanki gibi terminalde sorar. Açıkken bile bir isteğe yalnızca belirli bir süre bekler.",
      q2: "Verilerim bir yere gönderiliyor mu?", a2: "Hayır. Hesap, telemetri ya da analiz yok. Ağa yalnızca senin açtığın şeyler çıkar: Mesaj Atölyesi'nde ya da asistanın Burada sor seçeneğinde seçtiğin sağlayıcı ve şehir seçtiysen hava durumu. Asistan bir web uygulamasını ya da bağlantısıyla bir masaüstü uygulamasını açtığında mesajın, adresin içinde o servise gider ve hemen cevaplanabilir.",
      q3: "Yüksek riskli bir komut kendiliğinden onaylanabilir mi?", a3: "Hayır. Kurallar, güvenilen projeler ve oturum izinleri en fazla orta riske kadar otomatik izin verebilir. Yüksek ve kritik istekler her zaman basılı tutmayla, gerçek bir tıklamayla onaylanır; Linux'ta ise, bir programın sahte tıklaması gerçeğinden ayırt edilemediği için, adada değil terminalde onaylanır.",
      q4: "Claude masaüstü uygulamasıyla da çalışıyor mu?", a4: "Evet. Uygulamanın Code sekmesindeki Claude Code oturumları terminaldekiler gibi izlenir, izin istekleri de adaya gelir; ada her oturumun nerede çalıştığını yazar. Normal sohbet bölümü izlenmez.",
      q6: "Codex ve Cursor ile de çalışıyor mu?", a6: "Evet, ayarlardan bağladığında: Codex ve Cursor oturumları, gönderdiğin mesajlar ve desteklenen izin istekleri adada görünür. Ne kadarının desteklendiği her ajanın hook'larına bağlı; risk incelemesinin tamamı Claude Code içindir.",
      q5: "Ücretli mi?", a5: "Hayır. Nöbetçi ücretsiz ve MIT lisanslı açık kaynak bir projedir.",
      ctaTitle: "Yapay zekâ çalışsın, <em>sen izle.</em>", ctaText: "Birkaç dakikada kur, ilk izin isteğinde farkı gör.",
      owlLabel: "Baykuşun başını döndür", owlHint: "Tıkla, selam versin",
    },
    en: {
      title_home: "Nöbetçi — You make the call",
      desc_home: "Nöbetçi shows Claude Code's permission requests on an island at the top of your screen: see the command and its risk, then make the call. It watches Codex and Cursor too, with an assistant, an agenda, music, weather and system cards. Free for Windows, macOS and Linux.",
      title_demo: "Nöbetçi · Live demo",
      desc_demo: "Try Nöbetçi's real interface in your browser: approval cards, questions and plans, the assistant, the agenda, weather and system cards.",
      title_privacy: "Privacy policy — Nöbetçi",
      desc_privacy: "Nöbetçi's privacy policy: local records, optional AI message review, the island assistant and your choices.",
      title_signing: "Code signing policy — Nöbetçi",
      desc_signing: "Nöbetçi's code signing policy: the current status, what is signed, how a release is signed and the team's roles.",
      title_404: "Page not found — Nöbetçi",
      desc_404: "The page you're looking for isn't here.",

      skip: "Skip to content", menu: "Menu", menuClose: "Close", navMain: "Main navigation",
      navFeatures: "Features", navNew: "What's new", navDemo: "Live demo", navDownload: "Download", navFaq: "FAQ",
      langLabel: "Türkçeye geç", homeLabel: "Nöbetçi home page",
      footerLine: "A little owl for careful agents.", footerNav: "Footer", footerHome: "Home",
      footerPrivacy: "Privacy", footerSigning: "Code signing policy", footerChanges: "Release notes",
      footerLicense: "MIT license", footerContact: "Contact",
      back: "← Back to the Nöbetçi home page",

      nfTitle: "This page isn't on watch.",
      nfText: "The page you're looking for isn't here; it may have moved or been removed. You can carry on from the Nöbetçi home page.",
      nfHome: "Back to the home page", nfDemo: "Open the live demo",

      pill: "A sharper risk engine and safer approvals",
      heroTitle: "Let AI write the code.<br /><em>You make the&nbsp;call.</em>",
      heroText: "Nöbetçi watches your Claude Code sessions (Codex and Cursor too) from a small island at the top of your screen. When a permission request arrives, it shows the command and its risk at a glance; allowing or denying it is up to you.",
      download: "Download free", downloadFor: "Download for {os}", tryDemo: "Try the live demo",
      meta1: "Free and open source", meta2: "No account, no telemetry", meta3: "Windows · macOS · Linux",
      themeLabel: "Mascot", themeGroup: "The site's mascot and colours",
      barFile: "File", barView: "View", frameTitle: "The Nöbetçi island, live", stageHint: "Live · the real app's interface",
      stagePause: "Pause", stagePauseLabel: "Pause the tour", stagePlay: "Play", stagePlayLabel: "Play the tour",
      chip1: "Your call", chip1s: "High risk is never approved on its own", chip2: "Risk engine", chip2s: "Every command scored and explained",
      stripLabel: "Works with", stripLead: "Works with:", stripDesktop: "Claude desktop (Code)",
      stripAssistant: "The assistant opens your message in ChatGPT, Gemini, Perplexity and more",

      featuresEyebrow: "Stay in control", featuresTitle: "Know what's happening while your <em>agent works.</em>",
      featuresIntro: "Requests that could get lost in a terminal reach you on the island, in plain words. In between, the island works for you.",
      f1Title: "Understand the risk, and why",
      f1Text: "The approval card shows the whole command, file path or URL, marks the risky parts and lists the reasons. High-risk requests need a press and hold, and only a real mouse click counts; on Linux, high and critical requests are approved in the terminal.",
      f2Title: "Every session in one place",
      f2Text: "Terminal, VS Code or the Claude desktop app: wherever a session runs, its state and last step are on the island.",
      f2a: "Working, thinking, waiting, done", f2b: "Changed files and their diffs", f2c: "Context and plan limits (opt-in)",
      f2d: "Jump to the right window in one click",
      fqTitle: "Questions and plans on the island",
      fqText: "When Claude asks a multiple-choice question or wants its plan approved, the card shows it: pick an answer or write your own, approve the plan or send it back with a note. With several low-risk requests waiting, one click allows them all; medium and above are never part of it.",
      f3Title: "An assistant on the island",
      f3Text: "Type with <span class=\"kbd\">Ctrl</span> <span class=\"kbd\">Alt</span> <span class=\"kbd\">Space</span> or speak with 🎙 (Windows and macOS), and your message opens in ChatGPT, Claude, Gemini, Perplexity and more, in the desktop app when it's installed. Not sure what to ask? Ready-made prompts show the way.",
      f4Title: "Five cards, one island", f4Text: "Music and a focus timer, an agenda, a calendar, animated weather and live CPU · RAM · GPU. Cards only run while they're on screen.",
      cWeather: "Weather", cAgenda: "Agenda", cCalendar: "Calendar", cSystem: "System",
      f5Title: "Prompt Studio", f5Text: "Fix and sharpen a message before it goes to your agent. Local Ollama, or OpenAI if you choose; you review and copy the result yourself.",
      f5Example: "Example", f5BeforeTag: "Draft", f5Before: "fix login",
      f5AfterTag: "Rewritten", f5After: "Find and fix the XSS on the login page: escape user input, add a test for it and sum up what you changed.",
      f6Title: "Seven mascots, all alive",
      f6Text: "Owl, wolf, hawk, octopus, lion, canary and eagle. They cheer when you approve and frown when you deny; one can roam your desktop too, at the size you like.",
      altCritical: "An approval card for a critical command, with its risky parts and four findings",
      altSession: "A session's details: its recent steps, changed files and plan limits",
      altQuestion: "A question card showing two of Claude's questions with their options",
      altAssistant: "The assistant with its prompt library open", altWeather: "The weather card", altAgenda: "The agenda card",
      altCalendar: "The calendar card", altSystem: "The system card", altMascots: "Seven mascots side by side, each in a different mood",
      altSecurity: "The Safety page in the settings window",

      newEyebrow: "What's new", newTitle: "A little more capable <em>with every release.</em>", newAll: "All release notes →",
      d250: "23 November 2026", d241: "19 November 2026", d240: "19 November 2026", d233: "16–19 November 2026", d231: "15 November 2026", d230: "14 November 2026",
      n250a: "The risk engine catches many more dangerous commands; everyday ones stay low",
      n250b: "Denying no longer stops Claude; the history records every outcome",
      n250c: "On Linux, high and critical requests are approved in the terminal",
      n250d: "Updating on Windows keeps your hooks; many fixes across the island, settings and mascots",
      n241a: "A new look for the Windows installer and the macOS disk image",
      n241b: "An owl that waves during setup and cheers when it's done",
      n240a: "Answer Claude's multiple-choice questions on the island",
      n240b: "Approve plans on the island, or send them back with a note",
      n240c: "Allow every waiting low-risk request with one click",
      n240d: "Changed files with diffs; opt-in context and plan limits",
      n233a: "Permission requests from the Claude desktop app reach the island too",
      n233b: "Hooks fixed for the Claude desktop app on Windows",
      n231a: "Voice input (Windows and macOS) and about 20 ready-made prompts", n231b: "Messages open in installed AI apps",
      n231c: "Agenda with reminders, a new calendar, animated weather", n231d: "CPU · RAM · GPU card, adjustable focus length",
      n230a: "Linux support (.deb and AppImage); macOS out of beta", n230b: "An assistant on the island: ChatGPT, Claude, Gemini, Perplexity and more",
      n230c: "A new seekable media card on all three systems", n230d: "A refreshed settings window",

      demoEyebrow: "Live demo", demoTitle: "Try it <em>before you download.</em>",
      demoIntro: "The island below is the app's real interface. Pick a scenario, click the cards, try the buttons on an approval card; nothing runs on your computer.",
      howEyebrow: "Three steps", howTitle: "See it. Understand it.<br /><em>Then decide.</em>",
      s1: "A request appears", s1t: "When Claude Code asks permission for an action, the island opens and brings it to you.",
      s2: "Review what will run", s2t: "The whole command, its risk level, the reasons and any suspicious parts on one card.",
      s3: "Make your decision", s3t: "Allow, deny or hand it back to the terminal. If Nöbetçi is closed, your agent carries on without waiting.",
      howCaption: "The auto-allow ceiling, hold times and the real-click guard are yours to set.",

      dlEyebrow: "Download", dlTitle: "Nöbetçi is <em>ready to keep watch.</em>", dlIntro: "Download for free, connect Claude Code with the setup wizard, and decide on its first request.",
      dlLatest: "Latest release", yours: "Your system", get: "Download",
      winReq: "Windows 10 and 11, 64-bit. The setup wizard sets everything up.",
      macReq: "macOS 11 or later, Apple silicon and Intel in one package.",
      linuxReq: "x86-64; X11, or Wayland through XWayland, with a compositor running. A .deb for Debian and Ubuntu, an AppImage for any distribution. High and critical requests are approved in the terminal.",
      dlNote: "Every release comes with SHA256SUMS.txt so you can check your download. The source is MIT licensed.",
      dlUnsigned: "Windows releases are not code-signed yet (Nöbetçi has applied for SignPath Foundation's free code signing), so SmartScreen may warn you.",
      dlSigning: "Code signing policy",

      faqEyebrow: "Questions", faqTitle: "Things people ask",
      q1: "Does my agent get stuck if Nöbetçi is closed?", a1: "No. If the app is closed, the relay exits without doing anything and Claude Code asks in the terminal as usual. Even when it's open, it waits only so long for an answer.",
      q2: "Is my data sent anywhere?", a2: "No. No account, no telemetry, no analytics. Only what you switch on goes online: the provider you pick for Prompt Studio or the assistant's Here, and the weather if you choose a city. When the assistant opens a web app, or a desktop app through its link, your message travels to that service in the address and may be answered at once.",
      q3: "Can a high-risk command be approved automatically?", a3: "No. Rules, trusted projects and session grants can auto-allow up to medium risk at most. High and critical requests always need a press and hold with a real click; on Linux, where a program's fake click can't be told from a real one, they are approved in the terminal instead of on the island.",
      q4: "Does it work with the Claude desktop app?", a4: "Yes. Claude Code sessions in the app's Code tab are watched like terminal ones and their permission requests reach the island, which shows where each session runs. The regular chat isn't watched.",
      q6: "Does it work with Codex and Cursor?", a6: "Yes, once you connect them in Settings: Codex and Cursor sessions, the prompts you send and supported permission requests show on the island. How much is covered depends on each agent's hooks; the full safety review is for Claude Code.",
      q5: "Does it cost anything?", a5: "No. Nöbetçi is free, open source and MIT licensed.",
      ctaTitle: "Let AI work. <em>You keep watch.</em>", ctaText: "Set it up in a few minutes and see the difference at the first permission request.",
      owlLabel: "Make the owl turn its head", owlHint: "Click to say hello",
    },
  };

  const root = document.documentElement;
  const base = document.querySelector('meta[name="nobetci-base"]')?.content || "/";
  /** The language the HTML is written in. */
  const STATIC = "tr";

  function decide() {
    const asked = new URLSearchParams(location.search).get("lang");
    if (asked === "tr" || asked === "en") return asked;
    try {
      const saved = localStorage.getItem("nobetci-lang");
      if (saved === "tr" || saved === "en") return saved;
    } catch { /* storage is optional */ }
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language || STATIC];
    return String(preferred[0] || STATIC).toLowerCase().startsWith("tr") ? "tr" : "en";
  }

  /** The mascot the visitor picked for the site (mascot-themes.js keeps it). */
  function savedTheme() {
    try { return localStorage.getItem("nobetci-demo-theme") || "owl"; } catch { return "owl"; }
  }

  const lang = decide();
  const page = root.dataset.page || "home";
  root.lang = lang;
  // Scroll reveals hide their blocks from the first paint (site.js shows them),
  // so nothing appears, vanishes and fades back in.
  root.classList.add("js", "i18n");

  function head(next) {
    const dict = COPY[next];
    const title = dict[`title_${page}`];
    if (title) document.title = title;
    const desc = dict[`desc_${page}`];
    const meta = document.querySelector('meta[name="description"]');
    if (desc && meta) meta.setAttribute("content", desc);
  }
  head(lang);

  /** Screenshot address in a language. The hero poster shows the owl only. */
  function shot(name, next) {
    return `${base}shots/${next}/${name}.webp`;
  }

  /** Translates one element; `done` remembers what was written, so it is not rewritten. */
  function text(el, dict, done) {
    const value = dict[el.dataset.i18n];
    if (value == null) return;
    if (done && done.get(el) === el.innerHTML) return;
    if (/[<&]/.test(value)) el.innerHTML = value;
    else el.textContent = value;
    done?.set(el, el.innerHTML);
  }

  function attributes(el, dict, next) {
    const { i18nAria, i18nAlt, i18nTitle, shot: name } = el.dataset;
    if (i18nAria && dict[i18nAria]) el.setAttribute("aria-label", dict[i18nAria]);
    if (i18nAlt && dict[i18nAlt]) el.alt = dict[i18nAlt];
    if (i18nTitle && dict[i18nTitle]) el.title = dict[i18nTitle];
    if (name && el instanceof HTMLImageElement) {
      // The poster shows the owl; with another mascot picked it would change
      // species when the live island fades in, so it stays empty then. Once
      // the live island is up the poster is not needed at all.
      if (el.classList.contains("stage-poster") && (savedTheme() !== "owl" || el.closest(".is-live"))) return;
      const src = shot(name, next);
      if (el.getAttribute("src") !== src) el.setAttribute("src", src);
    }
  }

  const SELECTOR = "[data-i18n],[data-i18n-aria],[data-i18n-alt],[data-i18n-title],img[data-shot]";

  /** Every string and screenshot in `scope` in language `next`. */
  function apply(next, scope = document) {
    const dict = COPY[next];
    head(next);
    for (const el of scope.querySelectorAll(SELECTOR)) {
      if (el.dataset.i18n != null) text(el, dict, null);
      attributes(el, dict, next);
    }
  }

  // The hero poster: fetched early, in the visitor's language only.
  if (page === "home" && savedTheme() === "owl") {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.type = "image/webp";
    link.href = shot("idle-island", lang);
    link.setAttribute("fetchpriority", "high");
    document.head.append(link);
  }

  // While the page is parsed: each element as it arrives, before it is painted.
  if (document.readyState === "loading" && "MutationObserver" in window) {
    const dict = COPY[lang];
    const translate = lang !== STATIC;
    const done = new WeakMap();
    const visit = (el) => {
      if (!el.matches(SELECTOR)) return;
      if (translate && el.dataset.i18n != null) text(el, dict, done);
      attributes(el, dict, lang);
    };
    const handle = (records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          visit(node);
          for (const child of node.querySelectorAll(SELECTOR)) visit(child);
        }
        // The parser may still be adding text to an element translated a moment ago.
        if (translate) {
          const at = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          const host = at?.closest("[data-i18n]");
          if (host) text(host, dict, done);
        }
      }
    };
    const observer = new MutationObserver(handle);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    // Parsing is over before the deferred scripts run; they own the page from then on.
    document.addEventListener("readystatechange", () => {
      handle(observer.takeRecords());
      observer.disconnect();
    }, { once: true });
  }

  // Should site.js never arrive, show the page anyway.
  setTimeout(() => {
    if (!window.NobetciSite) root.classList.remove("js");
  }, 4000);

  window.NobetciI18n = {
    COPY,
    base,
    lang,
    apply,
    t: (next, key) => COPY[next]?.[key] ?? COPY[STATIC][key] ?? key,
  };
})();
