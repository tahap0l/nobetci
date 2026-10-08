# Nöbetçi kurulum kılavuzu

[English](install.md) · **Türkçe**

Bu kılavuz Nöbetçi'yi indirmekten Claude Code'a bağlamaya, güncellemekten kaldırmaya kadar her
adımı anlatır. Sonda bir sorun giderme bölümü var.

> **Mac mi kullanıyorsun?** 1–3. ve 8–10. bölümler Windows'u anlatır. Bu adımlar için
> [macOS](#macos) bölümünü oku — geri kalanı iki sistemde de aynı.

## İçindekiler

1. [Gereksinimler](#1-gereksinimler)
2. [İndirme ve doğrulama](#2-indirme-ve-doğrulama)
3. [Kurulum](#3-kurulum)
4. [Kurulum sihirbazı (ilk açılış)](#4-kurulum-sihirbazı-ilk-açılış)
5. [Claude Code'a bağlama](#5-claude-codea-bağlama)
6. [Çalıştığını deneme](#6-çalıştığını-deneme)
7. [Önerilen ilk ayarlar](#7-önerilen-ilk-ayarlar)
8. [Güncelleme](#8-güncelleme)
9. [Kaldırma](#9-kaldırma)
10. [Dosyalar nerede?](#10-dosyalar-nerede)
11. [Sorun giderme](#11-sorun-giderme)
12. [Kaynaktan derleme](#12-kaynaktan-derleme)
13. [macOS](#macos)

## 1. Gereksinimler

| | |
| --- | --- |
| İşletim sistemi | Windows 10 ya da 11, 64 bit — ya da macOS 11 ve üstü, bkz. [macOS](#macos) |
| Claude Code | Windows üzerinde çalışan Claude Code (terminal, VS Code, Cursor…). WSL içindeki Claude Code ayarlarını başka yerde tuttuğu için kapsam dışıdır. |
| WebView2 | Windows 11'de ve güncel Windows 10'da hazır gelir; yoksa kurulum programı indirir. |
| Yetki | Yönetici yetkisi **gerekmez**; Nöbetçi sadece senin kullanıcı hesabına kurulur. |

## 2. İndirme ve doğrulama

1. [Son sürüm sayfasından](https://github.com/tahap0l/nobetci/releases/latest) iki dosyayı
   indir:
   - `Nobetci-x.y.z-setup.exe` — kurulum programı
   - `SHA256SUMS.txt` — dosyanın parmak izi
2. İndirdiğin dosyanın yayınlananla aynı olduğunu kontrol et. İndirme klasöründe PowerShell aç ve
   şunu çalıştır:

   ```powershell
   Get-FileHash .\Nobetci-0.2.0-setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   İki satırdaki uzun değer **birebir aynı** olmalı (büyük/küçük harf fark etmez). Farklıysa dosyayı
   çalıştırma, tekrar indir.

## 3. Kurulum

1. `Nobetci-x.y.z-setup.exe` dosyasına çift tıkla.
2. **"Windows bilgisayarınızı korudu"** uyarısı çıkarsa: sürümler henüz kod imzalı olmadığı için
   SmartScreen yeni dosyayı tanımıyor. Parmak izini doğruladıysan **Ek bilgi → Yine de çalıştır**'a
   tıkla.
3. Kurulum birkaç saniye sürer ve `%LOCALAPPDATA%\Nobetci` klasörüne yapılır. Başlat menüsünde
   **Nobetci** olarak görünür.

> Sessiz kurulum için: `Nobetci-0.2.0-setup.exe /S`

## 4. Kurulum sihirbazı (ilk açılış)

Nöbetçi'yi Başlat menüsünden aç. Ekranın üst ortasında bir baykuş belirip seni selamlar, ardından ada
küçülür ve Nöbetçi saatin yanındaki bildirim alanından (tepsi) nöbet tutar.

İlk açılışta beş adımlık bir **kurulum sihirbazı** açılır:

| Adım | Ne yaparsın |
| --- | --- |
| 1. Hoş geldin | Dili seç: Otomatik (Windows diline göre), Türkçe ya da English. |
| 2. Bağlantı | Claude Code hook'larını kur (ayrıntısı aşağıda). |
| 3. Sağlık testi | Bağlantının uçtan uca çalıştığını gör. |
| 4. Güvenlik | Otomatik izin tavanını, basılı tutma sürelerini ve fiziksel tıklama korumasını ayarla. |
| 5. Hazır | Kısa ipuçları. |

Her adımı **Şimdilik atla** ile geçebilirsin; hepsi daha sonra **Ayarlar**'da da var. Sihirbazı
yeniden açmak için: **Ayarlar → Hakkında → Kurulum sihirbazını yeniden aç**.

## 5. Claude Code'a bağlama

Nöbetçi, Claude Code'u **hook**'lar üzerinden görür. Hook'lar `~/.claude/settings.json`
(`C:\Users\<sen>\.claude\settings.json`) dosyasına eklenir.

1. Sihirbazın **Bağlantı** adımında ya da **Ayarlar → Claude Code → Hook'ları kur…** ile başlat.
2. Nöbetçi dosyada yapılacak değişikliği **fark (diff)** olarak gösterir: eklenen satırlar yeşil.
   Diğer ayarların ve başka araçların hook'ları olduğu gibi kalır.
3. Değişikliğe göz at ve **Onayla ve yaz**'a tıkla. Yazmadan önce aynı klasöre tarihli bir yedek
   alınır (`settings.json.bak-YYYYMMDD-HHMMSS`).
4. **Ayarlar → Claude Code → Sağlık testi**'ne bas. Tüm satırlar ✓ olmalı:
   - hook'lar `settings.json`'da,
   - relay (`nobetci-hook.exe`) yerinde,
   - pipe üzerinden ping ulaşıyor (birkaç milisaniye),
   - fiziksel tıklama koruması hazır.
5. **Açık olan Claude Code oturumlarını yeniden başlat.** Claude Code hook'ları oturum başlarken
   okur.

## 6. Çalıştığını deneme

1. Yeni bir Claude Code oturumu başlat. Ada kısa süreliğine "oturum başladı" der; fareyi ekranın üst
   ortasına götürünce oturumunu bir satır olarak görürsün.
2. Claude'dan izin gerektiren bir şey iste, örneğin önceden izin vermediğin bir komutu çalıştırmasını.
3. Ada bir **onay kartıyla** açılır: komutun tamamı, risk seviyesi ve gerekçeler.
4. **İzin ver**'e normal şekilde tıkla. YÜKSEK ve KRİTİK isteklerde butonu çubuk dolana kadar basılı
   tut.

İstersen **Ayarlar → Güvenlik → Risk motorunu dene** bölümüne bir komut yazıp nasıl
puanlandığını hiçbir şey çalıştırmadan görebilirsin.

## 7. Önerilen ilk ayarlar

| Ayar | Nerede | Öneri |
| --- | --- | --- |
| Windows açılınca başlat | Ayarlar → Genel | Açık — Nöbetçi kapalıyken sorular terminale düşer. |
| Otomatik izin tavanı | Ayarlar → Güvenlik | **Sadece DÜŞÜK** (varsayılan). YÜKSEK ve KRİTİK zaten asla otomatik onaylanmaz. |
| Fiziksel tıklama koruması | Ayarlar → Güvenlik | Açık (varsayılan). Dokunmatik ekran ya da erişilebilirlik aracı kullanıyorsan bkz. [sorun giderme](#onay-reddedildi-fiziksel-tıklama-değil). |
| Kurallar | Ayarlar → Kurallar | Şablonlardan başla: `npm test`'e izin ver, force push yasak, `.env` dosyalarını okumasın. |
| Kısayollar | Ayarlar → Bildirimler | Ctrl+Alt+N adayı açar, Ctrl+Alt+D karttaki isteği reddeder. |
| Rahatsız etme | Adanın başlığındaki buton ya da tepsi menüsü | Sunum ya da oyun sırasında. Tam ekranda zaten kendiliğinden sessizleşir. |

## 8. Güncelleme

Yeni sürümün kurulum programını indirip (parmak izini doğrulayarak) çalıştırman yeterli. Ayarların,
geçmişin ve Claude Code hook'ların korunur. Güncelleme sırasında Nöbetçi kapanır; kurulum bitince
yeniden aç.

## 9. Kaldırma

**Ayarlar → Uygulamalar → Yüklü uygulamalar** (Windows 10'da **Uygulamalar ve özellikler**) içinde
**Nobetci**'yi bulup **Kaldır**'a tıkla. Kaldırıcı:

1. `~/.claude/settings.json` içindeki **yalnızca Nöbetçi'ye ait** girdileri siler; önce tarihli bir
   yedek alır, dosyadaki başka hiçbir şeye dokunmaz;
2. uygulamayı, relay'i ve kayıt dosyasını siler.

Ayarların (`%APPDATA%\Nobetci`) ve geçmişin (`%LOCALAPPDATA%\Nobetci\audit.jsonl`) kalır; yeniden
kurarsan kaldığın yerden devam eder. İz bırakmamak için bu iki klasörü de sil.

## 10. Dosyalar nerede?

| Ne | Nerede |
| --- | --- |
| Uygulama | `%LOCALAPPDATA%\Nobetci\` |
| Relay | `%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` |
| Ayarlar | `%APPDATA%\Nobetci\settings.json` |
| Geçmiş | `%LOCALAPPDATA%\Nobetci\audit.jsonl` (+ `audit.1.jsonl`) |
| Kayıt (log) | `%LOCALAPPDATA%\Nobetci\nobetci.log` |
| Claude Code hook'ları | `%USERPROFILE%\.claude\settings.json` (yedekler: `settings.json.bak-*`) |

**Ayarlar → Hakkında** sayfasındaki butonlar bu dosyaları Dosya Gezgini'nde gösterir.

## 11. Sorun giderme

### Ada oturumlarımı göstermiyor

- **Ayarlar → Claude Code → Sağlık testi**'ni çalıştır ve ✗ olan satırı oku.
- Hook'ları kurduktan sonra **Claude Code oturumunu yeniden başlattın mı?** Açık oturumlar yeni
  hook'ları görmez.
- Claude Code WSL içinde mi çalışıyor? O zaman ayarları Linux tarafında durur; Nöbetçi şu an yalnızca
  Windows üzerindeki Claude Code'u destekler.
- Hook'lar sonradan silindiyse Nöbetçi açılışta "hook'lar kaldırılmış" uyarısı verir;
  **Ayarlar → Claude Code**'dan yeniden kur.

### Sağlık testi: "Relay bulunamadı"

Nöbetçi'yi kapatıp yeniden aç; relay her açılışta yerine kopyalanır. Antivirüs yazılımın
`%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` dosyasını karantinaya aldıysa geri yükle ve istisna ekle.

### Sağlık testi: "Ping pipe'a ulaşmadı"

Nöbetçi'nin çalıştığından emin ol (tepside baykuş). Başka bir güvenlik yazılımı named pipe'ları
engelliyor olabilir. Sorun sürerse `%LOCALAPPDATA%\Nobetci\nobetci.log` dosyasındaki son satırlarla
bir issue aç.

### Onay reddedildi: fiziksel tıklama değil

Kartta *"Onay fiziksel bir tıklamadan gelmedi ve reddedildi"* yazıyor ama sen tıkladın.
Fiziksel tıklama koruması, onayın butonun üzerinde yapılmış gerçek bir fare basışından geldiğini
doğrular. Şunlar "gerçek fare basışı" üretmeyebilir:

- dokunmatik ekran ya da kalem,
- uzak masaüstü / uzaktan kontrol yazılımları,
- ekran klavyesi, sesli kontrol gibi erişilebilirlik araçları.

Bunlardan birini kullanıyorsan **Ayarlar → Güvenlik → Fiziksel tıklama koruması**'nı kapat. Normal
bir fareyle tıkladığın hâlde reddediliyorsa lütfen bir issue aç. Bu bir hata olur.

> Bu uyarıyı **sen tıklamadığın hâlde** görüyorsan, bilgisayarındaki bir program senin yerine
> onaylamaya çalışmış demektir. İsteği reddet ve o sırada ne çalıştığını kontrol et.

### Kısayollar çalışmıyor

**Ayarlar → Bildirimler → Kısayollar** her kısayolun durumunu gösterir. "Kaydedilemedi" yazıyorsa
başka bir uygulama aynı tuşları kullanıyordur; farklı bir kombinasyon seç.

### Ses ya da bildirim gelmiyor

Rahatsız etme, sessiz saatler ya da tam ekran sessizliği açık olabilir (adanın başlığında yazar). Windows'un
**Odaklanma / Rahatsız etmeyin** modu da Nöbetçi bildirimlerini gizler.

### Ada yanlış ekranda ya da bir şeyin üstünü kapatıyor

**Ayarlar → Genel**'den **Konum** (sol / orta / sağ) ve **Ekran** (ana ekran / imlecin olduğu
ekran) ayarlarını değiştir.

### Windows Defender kurulum programını işaretledi

İmzasız yeni programlarda makine öğrenmesi tabanlı yanlış pozitifler görülebilir. Önce parmak izini
`SHA256SUMS.txt` ile doğrula. Eşleşiyorsa bir issue aç; dosyayı Microsoft'a yanlış pozitif olarak
bildirmek de yardımcı olur.

### Nöbetçi'yi elle sildim, Claude Code her adımda hook hatası veriyor

Hook'lar artık olmayan bir dosyayı gösteriyor. En kolayı Nöbetçi'yi yeniden kurup **Ayarlar → Claude
Code → Kaldır…** ile hook'ları silmek ya da normal yoldan kaldırmak. Alternatif olarak
`~/.claude/settings.json.bak-*` yedeklerinden birini geri yükleyebilirsin.

### Daha fazla yardım

- Kayıt dosyası: `%LOCALAPPDATA%\Nobetci\nobetci.log`
- Hata bildirimi: [Issues](https://github.com/tahap0l/nobetci/issues)
- Güvenlik açığı: herkese açık issue yerine [özel bildirim](https://github.com/tahap0l/nobetci/security/advisories/new)
  ([SECURITY.md](../SECURITY.md))

## 12. Kaynaktan derleme

Gerekenler: MSVC araç zinciriyle [Rust](https://rustup.rs), Node.js 20+, "Desktop development with
C++" iş yüküyle [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

```powershell
git clone https://github.com/tahap0l/nobetci.git
cd nobetci
npm ci
npm test          # Rust testleri (relay'i de derler)
npm run pack      # → release\Nobetci-<sürüm>-setup.exe
```

Mac'te: Xcode Command Line Tools (`xcode-select --install`), iki Apple hedefiyle Rust
(`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) ve Node.js 20 ya da üstünü kur;
sonra `npm ci`, `npm test` ve `npm run pack:mac` (→ `release/Nobetci-<sürüm>-macos-universal.dmg`).

Ayrıntılar için [CONTRIBUTING.md](../CONTRIBUTING.md).

## macOS

macOS desteği 0.2.0 ile geldi ve henüz beta. Kurulum sihirbazı, Claude Code'a bağlama, deneme,
önerilen ayarlar ve sorun gidermenin çoğu (4–7. ve 11. bölümler) Mac'te de aynı. Bu bölüm farklı
olanları anlatır.

### Gereksinimler

| | |
| --- | --- |
| macOS | 11 Big Sur ya da üstü; Apple Silicon ya da Intel (tek, universal uygulama) |
| Claude Code | Doğrudan Mac'te çalışan: Terminal, iTerm2, VS Code, Cursor… |
| Yetki | Bir uygulamayı Uygulamalar klasörüne sürüklemekten fazlası gerekmez |

### İndirme ve doğrulama

1. [Son sürüm sayfasından](https://github.com/tahap0l/nobetci/releases/latest)
   `Nobetci-x.y.z-macos-universal.dmg` ve `SHA256SUMS.txt` dosyalarını indir.
2. İndirdiğini Terminal'de doğrula:

   ```sh
   cd ~/Downloads
   shasum -a 256 Nobetci-0.2.0-macos-universal.dmg
   grep macos SHA256SUMS.txt
   ```

   İki satırdaki uzun değer aynı olmalı. Farklıysa dosyayı açma, tekrar indir.

### Kurulum ve ilk açılış

1. Disk görüntüsünü aç, **Nobetci**'yi **Uygulamalar** (Applications) klasörüne sürükle, sonra
   disk görüntüsünü çıkar.
2. **Nobetci**'yi Uygulamalar'dan ya da Spotlight'tan aç. Sürümler henüz Apple tarafından
   onaylanmadığı (notarize edilmediği) için macOS ilk seferde durdurur:
   - **macOS 15 Sequoia ve sonrası:** Apple'ın "Nobetci"nin zararlı yazılım içermediğini
     doğrulayamadığını söyleyen bir mesaj çıkar. **Bitti**'yi seç. **Sistem Ayarları → Gizlilik
     ve Güvenlik**'i aç, *"Nobetci", Mac'inizi korumak için engellendi* satırına in, **Yine de
     Aç**'a tıkla, parolan ya da Touch ID ile onayla ve bir kez daha **Yine de Aç**'ı seç.
   - **macOS 14 ve öncesi:** Uygulamalar'da **Nobetci**'ye Control tuşuyla tıkla, **Aç**'ı seç,
     sonra yine **Aç**'ı seç.

   Bunu bir kez, bir de her güncellemeden sonra yaparsın.
3. **"Nobetci hasarlı ve açılamıyor" mu diyor?** Gerçek bir hasar değil, indirmenin karantina
   işareti. SHA-256'yı doğruladıktan sonra Terminal'de işareti kaldırıp tekrar aç:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Nobetci.app
   ```

   (Bir ajan bu komutu çalıştırmak isterse Nöbetçi onu YÜKSEK sayar — burada az önce doğruladığın
   bir uygulama için bunu yapan sensin.)
4. macOS sorduğunda bildirimlere izin ver. Sonradan **Sistem Ayarları → Bildirimler →
   Nobetci**'den değiştirebilirsin.

Baykuş menü çubuğunun hemen altında selam verir ve kurulum sihirbazı açılır —
[4. bölümden](#4-kurulum-sihirbazı-ilk-açılış) devam et.

### Mac'te neler farklı

- **Menü çubuğu uygulaması.** Dock'ta simgesi yok, ⌘-Sekme'de görünmez; Nöbetçi'nin menüsü menü
  çubuğunda.
- **Ada menü çubuğunun altında durur.** Çentikli MacBook'larda kamera çıkıntısının arkasında
  hiçbir şey kaybolmaz.
- **Kısayollar.** Ctrl, ⌃ Control; Alt, ⌥ Option tuşudur. Varsayılanlar ⌃⌥N (adayı aç) ve ⌃⌥D
  (reddet). Kendi kısayollarında ⌘ da kullanabilirsin.
- **Pencereye git**, oturumun uygulamasını (Terminal, iTerm2, VS Code…) öne getirir; belirli bir
  pencereyi ya da sekmeyi değil.
- **Adaya tıklamak Nöbetçi'yi etkin uygulama yapar**; terminal sen geri dönene kadar klavye
  odağını kaybeder (⌘-Sekme ya da **Pencereye git**). Windows'ta ada hiç odak almaz; Mac'te de
  böyle olması yapılacaklar listesinde.
- **Tam ekranda sessizlik** henüz yok. Rahatsız etme ve sessiz saatler çalışır.
- **Tıklama koruması**, onay tıklamasının gerçek bir fareden ya da trackpad'den geldiğini
  denetler: macOS her fare olayına onu kimin ürettiğini yazar. Bir program ancak ona Erişilebilirlik
  izni verdiysen (**Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik**) tıklama taklit
  edebilir; o listeyi kısa tut.
- **Oturum açınca başlat**, Nöbetçi için bir LaunchAgent ekler.

### Güncelleme

Yeni disk görüntüsünü indirip doğrula, Nöbetçi'den menü çubuğundan çık, yeni **Nobetci**'yi
Uygulamalar'a sürükle ve **Değiştir**'i seç. **Yine de Aç**'ı bir kez daha onaylaman gerekebilir.
Ayarların, geçmişin ve Claude Code hook'ların korunur.

### Kaldırma

1. **Ayarlar → Claude Code → Kaldır…**, Nöbetçi'nin girdilerini `~/.claude/settings.json`'dan
   çıkarır; her zamanki gibi fark gösterir ve tarihli yedek alır.
2. **Oturum açınca başlat** açıksa **Ayarlar → Genel**'den kapat.
3. Nöbetçi'den menü çubuğundan çık ve **Nobetci**'yi Uygulamalar'dan Çöp Sepeti'ne taşı.
4. Hiç iz kalmasın istiyorsan `~/Library/Application Support/Nobetci` klasörünü de sil.

1. adımı unuttun mu? Bir şey bozulmaz: relay o klasörde durur, dinleyen kimseyi bulamayıp çıkar ve
Claude Code yoluna devam eder. Uygulamayı silmeden önce
`/Applications/Nobetci.app/Contents/MacOS/nobetci --remove-hooks` komutunu da çalıştırabilirsin.

### Dosyalar nerede?

| Ne | Nerede |
| --- | --- |
| Uygulama | `/Applications/Nobetci.app` |
| Ayarlar | `~/Library/Application Support/Nobetci/settings.json` |
| Geçmiş | `~/Library/Application Support/Nobetci/audit.jsonl` (+ `audit.1.jsonl`) |
| Kayıt (log) | `~/Library/Application Support/Nobetci/nobetci.log` |
| Relay | `~/Library/Application Support/Nobetci/bin/nobetci-hook` |
| Relay soketi | `~/Library/Application Support/Nobetci/nobetci.sock` |
| Claude Code hook'ları | `~/.claude/settings.json` (yedekler: `settings.json.bak-*`) |

Finder `~/Library` klasörünü gizler: **Git → Klasöre Git…** (⇧⌘G) ile yolu yapıştır ya da
**Ayarlar → Hakkında**'daki butonları kullan.

### Mac'te sorun giderme

- **Ada oturumlarımı göstermiyor.** [11. bölümdeki](#11-sorun-giderme) gibi sağlık testini
  çalıştır ve Claude Code oturumunu yeniden başlat.
- **Onay reddedildi: fiziksel tıklama değil.** Ekran Paylaşımı ve diğer uzaktan kontrol araçları,
  Universal Control (başka bir Mac'in klavye ve faresi) ve Sesle Denetim ya da Anahtar Denetimi
  gibi erişilebilirlik araçları, macOS'un "bir programdan geldi" diye işaretlediği tıklamalar
  gönderir. Mac'in kendi faresini ya da trackpad'ini kullan veya **Ayarlar → Güvenlik → Fiziksel
  tıklama koruması**'nı kapat. Sıradan bir trackpad tıklaması reddediliyorsa lütfen bir issue aç
  — macOS koruması yeni.
- **Bildirim gelmiyor.** **Sistem Ayarları → Bildirimler → Nobetci**'den izin ver; bir Odak modu
  da bildirimleri gizleyebilir.
- **Kısayollar çalışmıyor.** **Ayarlar → Bildirimler → Kısayollar**, bir kombinasyonu başka bir
  uygulamanın kullanıp kullanmadığını gösterir.
- **Ada istediğim ekranda değil.** **Ayarlar → Genel**'den **Ekran**'ı değiştir.
