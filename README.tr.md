<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Nöbetçi'nin baykuşu">

# Nöbetçi

**Yapay zekâ kodlama ajanlarına göz kulak olan bir baykuş — şimdilik Claude Code için.**

[![CI](https://github.com/tahap0l/nobetci/actions/workflows/ci.yml/badge.svg)](https://github.com/tahap0l/nobetci/actions/workflows/ci.yml)
![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)
![macOS 11+ (beta)](https://img.shields.io/badge/macOS-11%2B%20(beta)-555555)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-2EA043)](LICENSE)

[English](README.md) · **Türkçe**

</div>

Nöbetçi, ekranının üst kenarında siyah bir adada yaşayan küçük bir baykuş. Claude Code
oturumlarını izler; biri izin istediğinde tam olarak neyin çalışacağını, ne kadar riskli
göründüğünü ve nedenini gösterir. Doğru terminali aramadan izin verir ya da reddedersin.

<p align="center">
  <img src="docs/media/tr/critical.png" width="720" alt="KRİTİK bir istek için Nöbetçi onay kartı: indirilen bir betiği bash'e veren ve AWS kimlik bilgilerini uzak bir makineye gönderen komut; riskli kısımlar vurgulu, dört bulgu listelenmiş, Reddet ve Basılı tut · İzin ver butonları">
</p>

## Neden

Claude Code bir komut çalıştırmadan, dosya yazmadan ya da bir araç çağırmadan önce sorar. Ama
terminalde sorar: o an bakmadığın terminalde ya da yan yana çalışan dördünden birinde. Sonuçta
sorular ya fark edilmeden bekler ya da refleksle onaylanır — üstelik terminaldeki bir soruda
`npm test` ile `curl … | bash` birbirinin aynısı görünür.

Nöbetçi bu kararı her zaman görebileceğin tek bir yere taşır. Her isteği dikkatli bir gözden
geçirici gibi okur, göze batanı ve nedenini söyler; tehlikeli olanlarda tek tıklama yetmez,
butonu bilerek basılı tutman gerekir. Sana ihtiyaç olmadığında ekranın üst kenarına çekilir.

## Özellikler

### 👁 İzle

- **Her oturum ayrı satırda.** Paralel Claude Code oturumları — Windows Terminal'de,
  Terminal.app'te, iTerm2'de, VS Code'da, Cursor'da ya da başka bir yerde — kendi satırında görünür: ne yapıyor, ne zamandır, bitti mi,
  hata mı verdi, seni mi bekliyor.
- **Oturum detayı.** Son adımların zaman çizelgesi, sayaçlar (araç, izin, ret, otomatik karar) ve
  oturumun terminalini ya da editörünü öne getiren **Pencereye git**.
- **Sadece gerektiğinde açılır.** İzin isteği, hata ya da Claude'un bir sorusu adayı açar;
  istersen biten oturum da. Geri kalan zamanda yoluna çıkmaz.
- Ada görünmezken **masaüstü bildirimleri**, kodla sentezlenen sesler ve ruh hali işe göre
  değişen bir baykuş.

### ✋ Karar ver

- **Risk puanlı onay kartları.** Her istek DÜŞÜK, ORTA, YÜKSEK ya da KRİTİK olarak puanlanır;
  gerekçeler listelenir, komutun riskli kısmı vurgulanır.
- **Ne görüyorsan o çalışır.** Kart komutun, dosya yolunun, URL'nin ya da MCP argümanlarının
  tamamını gösterir. Görünmez ve yön değiştiren Unicode karakterleri `⟦U+202E⟧` gibi işaretlere
  dönüşür, uzun boş satır ve boşluk dizileri `⟦40 boş satır⟧` gibi işaretlerle kısaltılır; bütün
  olarak taşınamayacak kadar uzun bir istek işaretlenir ve YÜKSEK sayılır — asla sessizce
  kesilmez.
- **Tehlikeliye basılı tutarak izin.** YÜKSEK ve KRİTİK isteklerde "İzin ver" butonunu basılı
  tutman gerekir (varsayılan 1,2 sn ve 2,4 sn). Bu kural sadece arayüzde değil, Rust tarafında
  uygulanır.
- **Gerekçeyle reddet.** Hazır bir gerekçe seç, Claude onu okusun; ya da **Reddet ve Claude'u
  durdur** ile turu bitir. **Terminale bırak** kararı Claude Code'un kendi sorusuna geri verir.
- **Yığılma değil, kuyruk.** Aynı anda gelen istekler sıraya girer — en fazla altı tane; fazlası
  terminale düşer, hiçbiri kaybolmaz.

### 🧭 Kontrol sende

- **Kendi kuralların.** Araca, desene (içerir, ile başlar, tam eşit, glob ya da regex) ve proje
  klasörüne göre eşleştir; izin ver, reddet, her zaman sor ya da riski yeniden puanla. Kurallar
  Rust'ta çalışır, ilk eşleşen kazanır, yerleşik test alanı sonucu kaydetmeden önce gösterir.
- **Proje güveni.** Klasörleri güvenilir (DÜŞÜK istekler kendiliğinden geçer), normal ya da sıkı
  (her istek bir seviye yüksek sayılır) olarak işaretle.
- **Otomasyona kesin bir tavan.** Kurallar, güvenilir projeler ve oturum izinleri kendi başına en
  fazla DÜŞÜK (varsayılan) ya da ORTA riske kadar onay verebilir; istersen hiç veremez. **YÜKSEK ve KRİTİK
  asla sensiz onaylanmaz.**
- **Geçmiş ve denetim kaydı.** Her izin isteği, riski, kararı ve kararı kimin verdiği: sen,
  kısayol, kural, güvenilir proje, oturum izni, zaman aşımı ya da terminal. Arama, filtreler,
  grafikler, CSV ve JSON dışa aktarma.
- **Gerektiğinde sessiz.** Rahatsız etme, sessiz saatler ve (Windows'ta) tam ekran bir uygulama
  öndeyken kendiliğinden sessizlik. İstekler yine sıraya girer; hiçbir şey açılmaz, ses çıkmaz.
- **Ve dahası.** Genel kısayollar, gerçek relay üzerinden hook sağlık testi, hangi hook
  olaylarının dinleneceğini seçme, risk kategorilerini tek tek kapatma, adanın konumu, ayarları
  içe ve dışa aktarma; sistem diline göre kendiliğinden Türkçe ya da İngilizce arayüz.

### 🔒 Gizlilik

- **Ağ yok, telemetri yok, hesap yok.** Nöbetçi hiçbir yere bağlanmaz — güncelleme bile kontrol
  etmez — ve API anahtarı ya da token saklamaz.
- **Bilgisayarında düz dosyalar.** Ayarlar, geçmiş ve kayıt dosyası JSON, JSON Lines ve düz
  metindir.
- **Sırlar kayda geçmez.** API anahtarları, token'lar, parolalar ve özel anahtarlar, istek geçmişe
  yazılmadan ya da bildirimde gösterilmeden önce maskelenir. Onay kartı ise isteği her
  zaman eksiksiz gösterir.

## Nasıl çalışır

```mermaid
flowchart LR
    CC["Claude Code<br/>(terminal ya da IDE)"]
    R["nobetci-hook<br/>küçük relay"]
    subgraph APP["Nöbetçi (tepsi / menü çubuğu uygulaması)"]
        direction TB
        E["Risk motoru + kuralların<br/>(Rust)"]
        I["Ada<br/>onay kartı"]
    end
    CC -- "hook olayı, stdin'de JSON" --> R
    R -- "named pipe ya da Unix soketi,<br/>sadece senin hesabın" --> E
    E -- "bir insan gerekiyor" --> I
    I -- "izin ya da ret" --> E
    E -- "karar" --> R
    R -- "stdout'ta karar JSON'u" --> CC
```

Claude Code, Nöbetçi'nin kayıtlı olduğu her hook olayında relay'i (`nobetci-hook`) çalıştırır.
Relay olayı sadece senin hesabının açabildiği bir kanaldan iletir — Windows'ta bir named pipe,
macOS'ta Library klasöründeki bir Unix soketi — ve çıkar. Yanıt
bekleyen tek olay izin isteğidir: risk motoru onu puanlar, ilk sözü kuralların söyler; bir kural,
güvenilir bir proje ya da oturum izni kararı anında verebilir. Gerisi adada bir karta dönüşür,
senin kararın da aynı yoldan geri döner.

Nöbetçi, Claude Code'u asla rehin tutmayacak biçimde tasarlandı:

| Durum | Ne olur |
| --- | --- |
| Nöbetçi çalışmıyor | Relay dinleyen kimseyi bulamaz, hiçbir çıktı vermeden hemen çıkar ve Claude Code her zamanki gibi terminalde sorar. Windows'ta var olan ama meşgul bir pipe için en fazla **300 ms** bekler. |
| Ada kartı gösteremiyor | Uygulama, kartın ekranda ya da sırada olduğunu doğrulaması için adaya **800 ms** tanır. Doğrulama gelmezse istek terminale döner. |
| Kimse yanıt vermiyor | Uygulama **108 sn**, relay **110 sn** sonra bırakır (hook'un kendisi 120 sn zaman aşımıyla kayıtlıdır). Ardından Claude Code terminalde sorar. |
| Duraklatıldı ya da sırada zaten altı istek var | Yeni istekler doğrudan terminale gider. |
| Diğer bütün hook olayları | Gönder ve unut: bağlan, yaz, çık — kesin bir 2 sn bütçeyle. |

## Kurulum

> 📖 [Kurulum kılavuzu](docs/kurulum.md) her adımı, güncellemeyi, kaldırmayı ve sorun gidermeyi
> ayrıntılı anlatır.

Nöbetçi **Windows 10 ve 11**'de (64 bit) ve **macOS 11 ya da üstünde** (Apple Silicon ve Intel;
macOS desteği yeni ve henüz beta) çalışır. Aynı sistemde çalışan
[Claude Code](https://code.claude.com/docs/en/overview) gerekir — WSL ya da bir konteyner içindeki
Claude Code ayarlarını başka bir yerde tutar, kapsam dışıdır.

### Windows

Microsoft Edge WebView2 Runtime Windows 11'de ve güncel Windows 10'da zaten vardır; yoksa kurulum
programı onu indirir.

1. [Son sürümden](https://github.com/tahap0l/nobetci/releases/latest) `Nobetci-x.y.z-setup.exe` ve
   `SHA256SUMS.txt` dosyalarını indir.
2. Kurulum dosyasının yayımlanan dosyanın kendisi olduğunu doğrula:

   ```powershell
   Get-FileHash .\Nobetci-0.2.0-setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   İki hash birebir aynı olmalı (büyük ya da küçük harf fark etmez).
3. Kurulumu çalıştır. Sadece senin Windows hesabın için, `%LOCALAPPDATA%\Nobetci` klasörüne
   kurulur ve yönetici izni istemez. Sessiz kurulum için `/S` ekle.

> [!NOTE]
> **"Windows bilgisayarınızı korudu" uyarısı mı çıktı?** Sürümler henüz kod imzalı değil, bu
> yüzden yeni bir kurulum dosyasının SmartScreen'de itibarı olmaz. Hash'i doğruladıktan sonra
> **Ek bilgi → Yine de çalıştır**'ı seç. İmzalı sürümler [yol haritasında](#yol-haritası).

### macOS (beta)

1. [Son sürümden](https://github.com/tahap0l/nobetci/releases/latest)
   `Nobetci-x.y.z-macos-universal.dmg` ve `SHA256SUMS.txt` dosyalarını indir.
2. Disk görüntüsünü Terminal'de doğrula:

   ```sh
   shasum -a 256 ~/Downloads/Nobetci-0.2.0-macos-universal.dmg
   cat ~/Downloads/SHA256SUMS.txt
   ```

3. Disk görüntüsünü aç ve **Nobetci**'yi **Uygulamalar** (Applications) klasörüne sürükle.
4. Uygulamalar'dan aç. Uygulama henüz Apple tarafından onaylanmadığı (notarize edilmediği) için
   macOS ilk seferde açmayı reddeder: **Bitti**'yi seç, sonra **Sistem Ayarları → Gizlilik ve
   Güvenlik**'e git, *"Nobetci" engellendi…* satırına in ve **Yine de Aç**'a tıkla. (macOS 14 ve
   öncesinde uygulamaya Control tuşuyla tıklayıp **Aç → Aç** demek de olur.)

Nöbetçi menü çubuğunda yaşar, Dock'ta simgesi olmaz. Ayrıntılar
[kurulum kılavuzunda](docs/kurulum.md#macos).

### Kaynaktan derleme

[Rust](https://rustup.rs) (MSVC araç zinciriyle), Node.js 20 ya da üstü ve "Desktop development
with C++" iş yüküyle [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
gerekir.

```powershell
git clone https://github.com/tahap0l/nobetci.git
cd nobetci
npm ci
npm test         # önce relay'i derler, sonra Rust testleri: risk motoru, kurallar, relay, geçmiş…
npm run pack     # → release\Nobetci-<sürüm>-setup.exe
```

Mac'te Xcode Command Line Tools (`xcode-select --install`), iki Apple hedefiyle Rust
(`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) ve Node.js 20 ya da üstü gerekir;
`npm run pack:mac`, `release/Nobetci-<sürüm>-macos-universal.dmg` dosyasını üretir.

## İlk çalıştırma

Nöbetçi'yi Başlat menüsünden (Mac'te Uygulamalar'dan) aç. Baykuş ekranın üstünde — Mac'te menü
çubuğunun hemen altında — selam verir, ardından ada kenara çekilir ve Nöbetçi bildirim alanından
(tepsiden; Mac'te menü çubuğundan) nöbetini sürdürür. İlk açılışta ayrıca kısa bir hoş
geldin sihirbazı açılır: dilini seç, Claude Code'a bağlan, sağlık testini çalıştır, güvenlik
temellerini ayarla, bitti. İstersen atlayabilirsin — sihirbazdaki her şey Ayarlar'da da var.

Nöbetçi'nin Claude Code'u görebilmesi için hook'larının `~/.claude/settings.json` dosyasında
olması gerekir. Sihirbazın **Claude Code'a bağlan** adımı — ya da istediğin zaman **Ayarlar →
Claude Code → Hook'ları kur…** — bunu dikkatle yapar:

- yapılacak değişikliği, dosyaya dokunulmadan önce fark (diff) olarak görürsün;
- dosyanın yanına önce tarihli bir yedek alınır (`settings.json.bak-YYYYMMDD-HHMMSS`);
- diğer ayarların ve başka araçların hook'ları olduğu gibi kalır;
- sen tıklamadan hiçbir şey yazılmaz; önizlemeyle tıklaman arasında dosya değişirse Nöbetçi
  yazmayı reddeder ve sana yeni farkı gösterir.

<p align="center">
  <img src="docs/media/tr/wizard.png" width="720" alt="İlk açılışta gelen hoş geldin sihirbazı">
</p>

Ardından **Ayarlar → Claude Code** sayfasında **Sağlık testi**'ne bas: relay'i tam Claude Code'un
çalıştırdığı gibi çalıştırır ve bir ping'in gidiş-dönüş süresini ölçer. Claude
Code hook'ları oturum başlarken okur; o sırada açık olan oturumları yeniden başlat.

## Kullanım

### Ada

<p align="center">
  <img src="docs/media/tr/overview.png" width="49%" alt="Açık ada: üç Claude Code oturumu, durumları ve son adımlarıyla">
  <img src="docs/media/tr/session.png" width="49%" alt="Oturum detayı: son adımların zaman çizelgesi, sayaçlar ve Pencereye git butonu">
</p>

- **Gizli** — üst kenarda ince, görünmez bir şerit. Fareyi oraya götürünce ada uyanır.
- **Kompakt** — tek satır durum ("2/3 çalışıyor", "Onay bekliyor — tıkla") ve her oturum için
  mini bir baykuş taşıyan küçük siyah bir hap. Tıklayınca açılır.
- **Açık** — oturumların, bir oturumun detayı ya da onay kartı. Fare çıktıktan 15 sn sonra
  (ayarlanabilir) küçülür; bekleyen bir istek varken asla.

Tepsi simgesinde (Mac'te menü çubuğu simgesinde) **Nöbetçi'yi aç**, **Ayarlar…**, **Duraklat / devam et**, **Rahatsız etme aç /
kapat** ve **Çıkış** var. Duraklatmak bekleyen her isteği terminale geri verir. Gizli bir ada
neredeyse hiç kaynak harcamaz: animasyon döngüsü durur, imleç takibi uykuya geçer.

### Onay kartı

<p align="center">
  <img src="docs/media/tr/low.png" width="720" alt="DÜŞÜK riskli bir npm test komutu için onay kartı: İzin ver butonu ve bu oturumda tekrar sormama seçeneği">
</p>

- **Başlıkta** risk seviyesi, oturum ve araç, sıradaki yerin ve terminalin devralmasına kalan
  süre görünür.
- **İstek** eksiksiz gösterilir — komut, dosya yolu (yazılacak içeriğin başıyla), URL ya da MCP
  argümanları — ve her bulgunun dayandığı kısım vurgulanır. Kutu kaydırılacak kadar uzunsa
  "devamı var — kaydır" yazar.
- **Bulgular** her gerekçeyi seviyesiyle listeler; varsa kural ya da proje notu da çıkar ("Sıkı
  proje" ya da izin vermek isteyip tavana takılan bir kural gibi).
- **İzin ver**, DÜŞÜK ve ORTA için tek tıklamadır. YÜKSEK ve KRİTİK'te buton **Basılı tut · İzin
  ver** olur: çubuk dolana kadar basılı tut.
- **Reddet** isteği geri çevirir. Yanındaki ok, Claude'a iletilen hazır gerekçeleri (Ayarlar →
  Kurallar'dan düzenlenir) ve turu bitiren **Reddet ve Claude'u durdur**'u açar.
- **Bu oturumda bu isteği tekrar sorma** yalnızca otomatik izin tavanının izin verdiği yerde
  çıkar: varsayılan tavanda DÜŞÜK için, *DÜŞÜK + ORTA* tavanında DÜŞÜK ve ORTA için; tavan
  kapalıyken hiç çıkmaz. Aynı oturumda, aynı araç ve aynı hedef için, Nöbetçi yeniden başlayana
  kadar geçerlidir.
- **Terminale bırak**, soruyu Claude Code'un terminaline geri verir.

### Risk seviyeleri

| Seviye | Anlamı | Örnekler |
| --- | --- | --- |
| **DÜŞÜK** | Belirgin bir şey yok — bu "güvenli" demek *değildir*. | `npm test`, `git status`, `cargo build --release`, `src/main.ts`'yi düzenlemek, `rm old.log` |
| **ORTA** | Bir göz atmaya değer. | `git push origin feature`, `npm i -D left-pad`, `pip install requests`, `gh pr create`, proje klasörü dışına yazmak, `.github/workflows/ci.yml`'yi düzenlemek, `mcp__gmail__send_email` |
| **YÜKSEK** | Bilinçli, görünür ya da geri alması zor. Basılı tutarak izin. | `rm -rf node_modules`, `git push --force`, `git reset --hard`, `npm publish`, `schtasks /create …`, `certutil -urlcache …`, `~/.ssh/id_rsa` ya da `.env` okumak, `.git/hooks/pre-commit` ya da `.mcp.json` yazmak, görünmez Unicode karakterleri |
| **KRİTİK** | Geri dönüşü yok ya da klasik bir saldırı kalıbı. Daha uzun basılı tutma. | `curl … \| bash`, `irm … \| iex`, `powershell -enc …`, `Set-MpPreference -DisableRealtimeMonitoring $true`, `vssadmin delete shadows`, `rm -rf ~`, `gh repo delete`, `~/.claude/settings.json` yazmak, aynı istekte bir sırrı okuyup dışarı göndermek |

İngilizce arayüzde seviyeler LOW, MEDIUM, HIGH ve CRITICAL olarak geçer.

<details>
<summary><b>Risk motoru neye bakar</b></summary>

**Komutlar** (Bash ve PowerShell)

- **KRİTİK** — internetten inen kodu doğrudan çalıştırmak (`curl … | sh`, `iex (irm …)`);
  kodlanmış ya da base64 ile gizlenmiş komutlar; Defender'ı ya da güvenlik duvarını kapatmak,
  gölge kopyaları ya da olay günlüklerini silmek, `bcdedit`; macOS'ta Gatekeeper'ı
  (`spctl --master-disable`), SIP'i, uygulama güvenlik duvarını ya da karantinayı kapatmak, gizlilik
  izinlerini sıfırlamak (`tccutil reset`) ya da birleşik günlüğü silmek; diski biçimlendirmek ya da
  üzerine yazmak (`diskutil erase…` dahil); ev dizinini, bir sürücüyü ya da kökü silmek; bir GitHub deposunu silmek ya da herkese
  açmak; Claude Code'un izin ya da hook ayarlarını değiştirmek; Nöbetçi'nin kendi ayarlarını
  değiştirmek ya da relay'ini değiştirmek; SSH `authorized_keys`'e dokunmak.
- **YÜKSEK** — Nöbetçi'yi kapatmaya çalışmak; özyinelemeli silme; zorla push ve geri alınamaz diğer git işlemleri; paket ya da
  sürüm yayınlamak; `sudo`, `runas`, `gsudo` ve AppleScript'in `with administrator privileges`'ı;
  kalıcılık (zamanlanmış görevler, Run anahtarları, servisler, başlangıç klasörleri, cron, systemd,
  LaunchAgents ve LaunchDaemons, oturum açma öğeleri); macOS karantina işaretini kaldırmak
  (`xattr -d`); macOS anahtar zincirini okumak (`security find-generic-password`,
  `dump-keychain`); `mshta`, `regsvr32 /i:`, `certutil -urlcache`
  ya da `bitsadmin /transfer` gibi şüpheli yerleşik Windows araçları; PowerShell betik
  politikasını devre dışı bırakmak; kimlik ve sır dosyaları; bilinen veri sızdırma servisleri
  (paste siteleri, istek yakalayıcılar, tüneller, sohbet webhook'ları); aşırı geniş izinler
  (`chmod 777`, `icacls … Everyone:F`, `takeown`); kapatma ve yeniden başlatma; veritabanında veri
  silen komutlar; ayrıcalıklı ya da ana makineyi bağlayan Docker çalıştırmaları ve Docker
  temizlikleri; bulutta kaynak silmek (`terraform destroy`, `kubectl delete`, `aws … delete-…` ve
  benzerleri); GitHub API ile silmek; görünmez ya da yön değiştiren karakterler; uzun boş satır ya
  da boşluk dizileriyle gözden kaçırılan içerik.
- **ORTA** — dışarı veri göndermek (`curl -d`, `nc`, `scp`, uzak bir hedefe `rsync`, FTP,
  `Send-MailMessage`); ortam değişkenlerini dökmek; kayıt defteri değişiklikleri ve `setx`;
  süreç sonlandırmak; paket kurmak ya da paket deposundan indirip doğrudan çalıştırmak
  (`npm i`, `npx -y`, `pip install`, `winget install`, `brew install` …); dinamik kod (`iex`,
  `eval`, `python -c`, `node -e`, `osascript -e`); `git push`; PR ya da issue açmak, yorum yazmak, gist oluşturmak gibi GitHub'da
  herkesin göreceği işlemler; Claude Code ayarlarına dokunmak; çok uzun komutlar.
- **DÜŞÜK**, bağlam için — ağ erişimi, tek tek dosya silmek ya da taşımak, git geçmişini yeniden
  yazmak.

**Dosya yazma** — Claude Code ayar dosyaları, Nöbetçi'nin kendi dosyaları ve `~/.ssh` altındaki
her şey için KRİTİK; Claude
Code hook, agent, komut, skill ve eklentileri, `.mcp.json`, git hook'ları ve git ayarı, kabuk
profilleri, başlangıç klasörleri ve LaunchAgents, sistem dosyaları, sır dosyaları (macOS anahtar
zinciri dahil) ve özel anahtar ya da
görünmez karakter içeren içerik için YÜKSEK; CI iş akışları, `CLAUDE.md`, kurulum betikleri
(`postinstall`), koda gömülmüş görünen sırlar ve proje klasörü dışındaki her şey için ORTA;
`package.json`, `Cargo.toml` ya da `Dockerfile` gibi build dosyaları için DÜŞÜK. `.env.example`
gibi şablonlar yol kurallarını tetiklemez.

**Dosya okuma** — sırlar için YÜKSEK (SSH anahtarları, `.env`, kimlik dosyaları, bulut ve
Kubernetes ayarları, tarayıcı çerezleri ve kayıtlı girişler).

**Web** — bilinen veri sızdırma servisleri için YÜKSEK, çıplak IP adresleri ve çok uzun sorgu
dizgileri için ORTA, şifresiz `http://` için DÜŞÜK.

**MCP araçları** — araç adı silme, kaldırma, çöpe atma, yok etme, düşürme, temizleme ya da iptal
söylüyorsa (delete, remove, trash, destroy, drop, purge, revoke) YÜKSEK; bir şey gönderiyor,
yayınlıyor, oluşturuyor, güncelliyor, yüklüyor, ödüyor, dağıtıyor ya da çalıştırıyorsa ORTA;
gerisi DÜŞÜK.

**Birleşimler** — aynı istekte bir sır ve dışarı giden bir yol varsa KRİTİK, sığması için
kesilmek zorunda kalınan bir istek YÜKSEK. Bu ikisi kapatılamaz; diğer bütün kategoriler
**Ayarlar → Güvenlik → Risk kategorileri**'nden tek tek kapatılabilir. Aynı sayfada yazdığın her
komutu, yolu ya da URL'yi puanlayan bir test alanı da var.

</details>

### Kurallar, proje güveni ve tavan

<p align="center">
  <img src="docs/media/tr/settings-rules.png" width="720" alt="Ayarlar'daki Kurallar sayfası: araç, desen ve eylemleriyle kurallar listesi ve proje güveni ayarları">
</p>

Kurallar, kart gösterilmeden önce yukarıdan aşağı denenir; ilk eşleşen kazanır.

| Bir kural… | Nasıl davranır |
| --- | --- |
| **İzin verebilir** | Sadece otomatik izin tavanına kadar. Daha riskli bir eşleşme yine sana gelir; hangi kuralın izin vermek istediği de yazılır. |
| **Reddedebilir** | Her seviyede. İstek sana hiç gelmez, Claude senin mesajını alır. |
| **Her zaman sordurabilir** | Güvenilir bir projenin ya da oturum izninin geçireceği yerde bile. |
| **Yeniden puanlayabilir** | Seviyeyi DÜŞÜK'ten KRİTİK'e kadar ayarlar — yanlış alarmlar için kullanışlı. KRİTİK bir bulgu asla YÜKSEK'in altına inmez, yani yine basılı tutman gerekir. |

Şablonlar iyi bir başlangıç: `npm test`'e ve salt okuyan git komutlarına izin ver, `git push --force`
ve paket yayınlamayı yasakla, Claude'u `.env` dosyalarından uzak tut, `rm -rf`'yi her zaman
KRİTİK say, MCP araçları için her seferinde sor.

**Proje güveni** (Ayarlar → Kurallar) — *güvenilir*: DÜŞÜK istekler tavan izin veriyorsa
kendiliğinden geçer; *normal*: varsayılan; *sıkı*: her istek bir seviye yüksek sayılır (ORTA
YÜKSEK'e, YÜKSEK KRİTİK'e çıkar). İç içe klasörlerde en özel olan geçerlidir.

**Otomatik izin tavanı** (Ayarlar → Güvenlik) — *Kapalı*, *Sadece DÜŞÜK* (varsayılan) ya da
*DÜŞÜK + ORTA*. Kuralların, güvenilir projelerin ve oturum izinlerinin sensiz onaylayabileceği en yüksek riski
belirler. YÜKSEK ve KRİTİK asla otomatik onaylanmaz: sınır Rust'ta durur ve elle düzenlenmiş bir
ayar dosyası onu kaldıramaz.

### Geçmiş

<p align="center">
  <img src="docs/media/tr/settings-history.png" width="720" alt="Ayarlar'daki Geçmiş sayfası: günlük kararlar ve risk seviyeleri grafikleri ile aranabilir istek listesi">
</p>

Her izin isteği kayda geçer: ne zaman, hangi proje ve araç, hedef (en fazla 4.000 karakter,
sırlar maskeli), risk ve bulgular, karar, kararı kimin verdiği ve ne kadar sürdüğü. Arayabilir,
filtreleyebilir, günlük grafiklere ve en sık görülen projelere, bulgulara ve araçlara
bakabilirsin; eşleşen her şeyi CSV ya da JSON olarak dışa aktarabilirsin. CSV dosyasını bir
tablo programında açmak güvenlidir: formül gibi okunacak hücreler etkisiz hâle getirilir.

Geçmiş, Nöbetçi'nin veri klasöründeki `audit.jsonl` dosyasında durur (bkz.
[Geliştirme](#geliştirme)); dosya 10 MB'a ulaşınca
(ayarlanabilir) eski kayıtlar `audit.1.jsonl`'e taşınır. **Ayarlar → Geçmiş**'ten kapatılabilir
ya da temizlenebilir.

### Kısayollar

| Eylem | Varsayılan |
| --- | --- |
| Adayı aç ya da kapat | `Ctrl+Alt+N` |
| Karttaki isteği reddet | `Ctrl+Alt+D` |
| Karttaki isteğe izin ver | Atanmamış — sadece DÜŞÜK riskli istekler |
| Rahatsız etmeyi aç / kapat | Atanmamış |

Mac'te Ctrl, ⌃ Control; Alt, ⌥ Option tuşudur. Kısayollar her pencerede çalışır. Her program
klavye vuruşu taklit edebilir; bu yüzden izin
kısayolu varsayılan olarak kapalıdır ve — Rust tarafından zorlanarak — DÜŞÜK'ün üstünde hiçbir
şeyi onaylamaz. **Ayarlar → Bildirimler**'den değiştirebilirsin.

### Sessizlik

**Rahatsız etme** (adadaki ay butonu, tepsi menüsü ya da kısayol), **sessiz saatler** (örneğin
23:00–08:00) ve **tam ekranda sessiz** (şimdilik sadece Windows'ta; varsayılan olarak açık; oyun,
sunum ve tam ekran video için). Sessizken ses çalmaz, bildirim gelmez, ada kendiliğinden açılmaz — ama istekler yine
sıraya girer ve kompakt ada bekleyen bir istek olduğunu söyler.

## Güvenlik modeli

Nöbetçi ikinci bir göz, bir sandbox değil. Risk motoru sezgisel kurallardan oluşur: bariz olanı
ve klasik olanı yakalar, kararlı bir saldırgan onu atlatabilir; DÜŞÜK "belirgin bir şey yok"
demektir, asla "güvenli" değil. Kattığı şey görünürlük, tehlikeli işlerde bilinçli bir yavaşlama
ve okuyabileceğin gerekçelerdir.

<p align="center">
  <img src="docs/media/tr/settings-security.png" width="720" alt="Ayarlar'daki Güvenlik sayfası: otomatik izin tavanı, basılı tutma süreleri, fiziksel tıklama koruması ve risk kategorileri">
</p>

Özen gösterdiği şeyler: kart tam olarak neyin çalışacağını gösterir; YÜKSEK ve KRİTİK onaylar
Rust'ın zorladığı bir basılı tutma ister; onaylar "İzin ver" butonunun üzerinde yapılmış fiziksel
bir fare tıklamasından gelmelidir — bir tıklama, bir onay — yani bir betik ajan adına "İzin ver"e
basamaz; relay ile uygulama sadece senin hesabının açabildiği bir named pipe (Windows) ya da Unix
soketi (macOS) üzerinden konuşur ve relay karşı uçtaki uygulamanın senin hesabınla çalıştığını
denetler; geçmiş sırları maskeler, CSV dışa aktarımı formül enjeksiyonuna karşı korumalıdır.

Yapamadıkları: zaten senin hesabınla çalışan bir zararlıyı durdurmak, terminalde verdiğin onayları
görmek ya da her sahte girdiyi gerçeğinden ayırmak. Tehdit modelinin tamamı ve bir güvenlik
açığını nasıl bildireceğin için [SECURITY.md](SECURITY.md)'ye bak.

## SSS

**Claude Code'u yavaşlatır ya da bloklar mı?**
Hayır. Relay küçük, yerel bir program: bağlanır, olayı teslim eder ve çıkar; kesin 2 saniyelik
bir bütçesi vardır, pratikte çok daha azını kullanır (**Sağlık testi** senin makinendeki
gidiş-dönüş süresini gösterir). Nöbetçi çalışmıyorsa relay hemen çıkar. Sadece izin istekleri
bekler; o da sadece kart gerçekten ekranındayken ve terminal devralmadan önce en fazla 110 saniye.

**Bir yere veri gönderiyor mu?**
Hayır. Nöbetçi hiçbir ağ bağlantısı kurmaz: telemetri yok, hata raporu yok, güncelleme denetimi
yok, hesap yok. Her şey bilgisayarında, düz dosyalarda kalır.

**Nöbetçi kapalıysa, duraklatılmışsa ya da çökerse ne olur?**
Claude Code, Nöbetçi hiç kurulmamış gibi devam eder: dinleyen kimse yoksa (ya da ada
duraklatılmışsa) relay çıktı vermeden çıkar ve Claude Code terminalde sorar.

**Kaldırınca ne olur?**
Windows'ta kaldırma programı `nobetci.exe --remove-hooks` komutunu çalıştırır; bu da
`~/.claude/settings.json` içinden sadece Nöbetçi'nin girdilerini siler — dosyanın yanına tarihli
bir yedek bırakarak — ve başka hiçbir şeye dokunmaz. Mac'te kaldırma programı olmadığı için
hook'ları önce Ayarlar'dan kaldır. Bkz. [Kaldırma](#kaldırma).

**macOS'ta çalışır mı? Linux'ta?**
macOS 11 ve üstünde evet — 0.2.0 ile geldi ve henüz beta; tuhaf bir şey görürsen lütfen bildir.
Orada birkaç şey farklı: ada menü çubuğunun altında durur, ona tıklamak Nöbetçi'yi etkin uygulama
yapar, **Pencereye git** belirli bir pencereyi değil oturumun uygulamasını öne getirir, tam ekranda
sessizlik henüz yok. Linux
[yol haritasında](#yol-haritası).

**macOS neden açmayı reddediyor?**
Sürümler henüz Apple tarafından onaylanmıyor (notarize edilmiyor). SHA-256'yı doğrula, sonra bir
kereliğine **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** ile aç.
[Kurulum kılavuzu](docs/kurulum.md#macos) adım adım anlatıyor.

**SmartScreen ya da Defender neden uyarıyor?**
Kurulum dosyası henüz kod imzalı değil, bu yüzden SmartScreen'de itibarı yok. SHA-256'yı sürümle
karşılaştır, ardından **Ek bilgi → Yine de çalıştır**'ı seç. Microsoft Defender bir sürümü
işaretlerse lütfen [bir issue aç](https://github.com/tahap0l/nobetci/issues); dosyayı Microsoft'a
yanlış pozitif olarak bildirmek de işe yarar.

**VS Code, Cursor, Windows Terminal, Terminal.app ya da iTerm2 ile çalışır mı?**
Evet. Nöbetçi doğrudan Claude Code'a bağlandığı için oturumun nerede çalıştığı fark etmez.
**Pencereye git**, oturumun süreç zincirini izleyerek yaşadığı pencereyi (Mac'te uygulamayı)
bulur; bulamazsa proje klasörünü açar.

**Claude kendi isteklerini Nöbetçi üzerinden onaylayabilir mi?**
Ada üzerinden hayır: onaylar fiziksel bir tıklamadan gelmeli, izin kısayolu varsayılan olarak
kapalı ve sadece DÜŞÜK risk için, YÜKSEK ve KRİTİK ise basılı tutma istiyor. Ama onaylanmış bir
komutun başlattığı her şey senin yetkilerinle çalışır ve örneğin Claude Code'un ayarlarını
doğrudan değiştirebilir — tam da bu yüzden böyle istekler KRİTİK sayılır. Ayrıntılar
[tehdit modelinde](SECURITY.md).

## Kaldırma

### Windows

**Ayarlar → Uygulamalar → Yüklü uygulamalar**'ı (Windows 10'da **Uygulamalar ve özellikler**)
aç, **Nobetci**'yi bul ve **Kaldır**'ı seç. Kaldırma programı:

1. `~/.claude/settings.json`'dan Nöbetçi'nin girdilerini, yanına tarihli bir
   `settings.json.bak-YYYYMMDD-HHMMSS` yedeği aldıktan sonra siler — dosyada başka hiçbir şey
   değişmez;
2. uygulamayı, relay'i (`%LOCALAPPDATA%\Nobetci\bin`) ve kayıt dosyasını kaldırır.

Tercihlerin (`%APPDATA%\Nobetci`) ve geçmişin (`%LOCALAPPDATA%\Nobetci\audit.jsonl`) yerinde
kalır; yeniden kurarsan kaldığın yerden devam edersin. Hiç iz kalmasın istiyorsan bu iki klasörü
de sil. Hook'ları önce kendin kaldırmayı tercih edersen **Ayarlar → Claude Code → Kaldır…** farkı
her değişiklikte olduğu gibi gösterir.

### macOS

1. **Ayarlar → Claude Code → Kaldır…** Nöbetçi'nin girdilerini `~/.claude/settings.json`'dan
   çıkarır (her zamanki gibi fark ve tarihli yedekle).
2. **Oturum açınca başlat** açıksa **Ayarlar → Genel**'den kapat.
3. Nöbetçi'den menü çubuğundan çık ve **Nobetci**'yi Uygulamalar'dan Çöp Sepeti'ne taşı.

Tercihlerin, geçmişin ve relay `~/Library/Application Support/Nobetci` klasöründe kalır; hiç iz
kalmasın istiyorsan o klasörü de sil. 1. adımı unuttun mu? Bir şey bozulmaz: relay o klasörde
durur, dinleyen kimseyi bulamayıp çıkar ve Claude Code yoluna devam eder. İstersen uygulamayı
silmeden önce `/Applications/Nobetci.app/Contents/MacOS/nobetci --remove-hooks` komutunu
çalıştırabilirsin.

## Geliştirme

```powershell
npm run dev          # sadece arayüz, tarayıcıda, demo verilerle (Rust gerekmez)
npm run tauri dev    # gerçek uygulama, canlı yenilemeyle
npm test             # Rust testleri
npm run lint         # clippy (uyarılar hata sayılır) ve TypeScript tip denetimi
npm run pack         # Windows kurulum dosyası, release\ klasörüne
npm run pack:mac     # macOS disk görüntüsü (universal), release/ klasörüne
```

`npm run dev` çalışırken:

- `http://127.0.0.1:1420/?demo=critical` adayı sahte oturumlar ve isteklerle gösterir. Diğer
  demolar: `low`, `write`, `hidden`, `deny-menu`, `overview`, `session`, `compact`, `empty`.
- `http://127.0.0.1:1420/settings.html?tab=kurallar` Ayarlar'ı sahte verilerle açar. Sekmeler:
  `genel`, `claude`, `guvenlik`, `kurallar`, `bildirimler`, `gecmis`, `hakkinda`; hoş geldin
  sihirbazı için `hosgeldin`.
- Dili seçmek için `&lang=tr` ya da `&lang=en`, Mac metinlerini görmek için `&platform=macos` ekle.
- Tarayıcı konsolunda `nobetci.inject({ … })` adaya sahte bir hook olayı gönderir.

```text
hook/                  nobetci-hook — Claude Code'un her hook olayında çalıştırdığı relay
  src/win.rs · mac.rs  named pipe (Windows) / Unix soketi (macOS), üst süreç zinciri
src-tauri/src/
  risk.rs              risk motoru ve kategoriler (+ testler)
  rules.rs             kullanıcı kuralları, proje güveni, oturum izinleri (+ testler)
  pipe.rs              relay sunucusu ve onay kararları
  pipe/                named_pipe.rs (Windows) · unix_socket.rs (macOS)
  audit.rs             geçmiş, istatistik, CSV/JSON dışa aktarma (+ testler)
  redact.rs            geçmiş ve bildirimler için sır maskeleme
  inputguard.rs        fiziksel tıklama koruması
  inputguard/          raw_input.rs (Windows Raw Input) · appkit.rs (macOS olay kaynağı)
  hooks.rs             ~/.claude/settings.json kurulumu ve kaldırılması (fark + yedek)
  settings.rs          tercihler ve sınırları
  island.rs            şeffaf, tıklama geçirgen ada penceresi
  sys.rs               işletim sistemine göre küçük yardımcılar: saat, dil, tam ekran, ev klasörü
  quiet.rs · focus.rs · hotkeys.rs · tray.rs · i18n.rs
src/
  baykus/              baykuş, selamlaması ve mini kafalar (Canvas 2D)
  island/              durum makinesi, hook olayları, geometri
  ui/                  ada görünümleri, onay kartı dahil
  core/                durum, Rust köprüsü, sentez sesler
  settings/            ayarlar penceresi
  i18n/                Türkçe ve İngilizce metinler
scripts/               kurulum paketleme, ikon üretici, ekran görüntüleri, denetimler
```

| Ne | Windows | macOS |
| --- | --- | --- |
| Tercihler | `%APPDATA%\Nobetci\settings.json` | `~/Library/Application Support/Nobetci/settings.json` |
| Geçmiş | `%LOCALAPPDATA%\Nobetci\audit.jsonl` (+ `audit.1.jsonl`) | `~/Library/Application Support/Nobetci/audit.jsonl` |
| Kayıt dosyası | `%LOCALAPPDATA%\Nobetci\nobetci.log` | `~/Library/Application Support/Nobetci/nobetci.log` |
| Relay | `%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` | `~/Library/Application Support/Nobetci/bin/nobetci-hook` |
| Claude Code hook'ları | `%USERPROFILE%\.claude\settings.json` | `~/.claude/settings.json` |

Claude Code ayarlarının yedekleri yanlarında `settings.json.bak-*` adıyla durur.

Katkılara açığız — kurulum, temel kurallar ve yanlış pozitif bildirimi için
[CONTRIBUTING.md](CONTRIBUTING.md)'ye bak (İngilizce).

## Yol haritası

Söz değil, fikir:

- **İmzalı sürümler** — örneğin [SignPath Foundation](https://signpath.org/)'ın açık kaynak
  projelere ücretsiz kod imzalamasıyla.
- **Apple onaylı (notarize) macOS sürümleri**, Gatekeeper dolambaçsız açsın diye.
- **Diğer ajanlar** — Cursor ve hook ya da izin API'si sunan başka kodlama ajanları.
- **Linux**; macOS'ta tam ekranda sessizlik ve hiç odak almayan bir ada.
- **Daha keskin kurallar** — daha geniş kapsam, daha az yanlış pozitif. Bildirimlerin çok değerli.

## Teşekkürler

Nöbetçi, Louis Raillé'nin [Coucou](https://github.com/Louis-CFM/coucou) uygulamasının (MIT) bir
fork'u olarak başladı. Named pipe relay'i, pipe sunucusu, farkı gösterilerek onaylanan hook
kurulumu, şeffaf ada penceresi ve açılıp kapanma durum makinesi oradan alınıp uyarlandı. Baykuş,
ikonlar, sentez sesler, risk motoru ve onun üzerine kurulan her şey Nöbetçi'ye özgüdür;
Coucou'nun adı, karakteri, ikonları ve sesleri kullanılmamıştır. Ayrıntılar
[NOTICE.md](NOTICE.md)'de.

## Lisans

[MIT](LICENSE). Coucou'dan uyarlanan kısımlar için [NOTICE.md](NOTICE.md)'ye bak.
