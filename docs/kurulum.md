# Nobi kurulum kılavuzu

[English](install.md) · **Türkçe**

Bu kılavuz Nobi'yi indirmekten Claude Code'a bağlamaya, güncellemekten kaldırmaya kadar her
adımı anlatır. Sonda bir sorun giderme bölümü var.

> **Mac ya da Linux mu kullanıyorsun?** 1–3. ve 8–10. bölümler Windows'u anlatır. Bu adımlar için
> [macOS](#macos) ya da [Linux](#linux) bölümünü oku — geri kalanı her sistemde aynı.

## İçindekiler

1. [Gereksinimler](#1-gereksinimler)
2. [Dosyayı indirme ve doğrulama](#2-dosyayı-indirme-ve-doğrulama)
3. [Kurulum](#3-kurulum)
4. [Kurulum sihirbazı (ilk açılış)](#4-kurulum-sihirbazı-ilk-açılış)
5. [Claude Code'a bağlama](#5-claude-codea-bağlama) (ve Codex, ChatGPT Work ve Cursor)
6. [Çalıştığını deneme](#6-çalıştığını-deneme)
7. [Önerilen ilk ayarlar](#7-önerilen-ilk-ayarlar)
8. [Güncelleme](#8-güncelleme)
9. [Kaldırma](#9-kaldırma)
10. [Dosyalar nerede?](#10-dosyalar-nerede)
11. [Sorun giderme](#11-sorun-giderme)
12. [Kaynaktan derleme](#12-kaynaktan-derleme)
13. [macOS](#macos)
14. [Linux](#linux)

## 1. Gereksinimler

| | |
| --- | --- |
| İşletim sistemi | Windows 10 ya da 11, 64 bit — ya da macOS 11 ve üstü, bkz. [macOS](#macos) — ya da Linux, bkz. [Linux](#linux) |
| Claude Code | Windows üzerinde çalışan Claude Code (terminal, VS Code, Cursor, Claude masaüstü uygulaması…). WSL içindeki Claude Code ayarlarını başka yerde tuttuğu için kapsam dışıdır. Codex, ChatGPT Work ve Cursor isteğe bağlıdır. |
| WebView2 | Windows 11'de ve güncel Windows 10'da hazır gelir; yoksa kurulum programı indirir. |
| Yetki | Yönetici yetkisi **gerekmez**; Nobi sadece senin kullanıcı hesabına kurulur. |

## 2. Dosyayı indirme ve doğrulama

1. [Son sürüm sayfasından](https://github.com/tahap0l/nobi/releases/latest) şunları indir:
   - `Nobi-x.y.z-setup.exe` — kurulum programı (`x.y.z` sürüm numarasıdır; 2.4.1'den sonraki
     sürümlerde aynı dosya `Nobi-setup.exe` adıyla da durur)
   - `SHA256SUMS.txt` — sürümdeki her dosyanın parmak izi
2. İndirdiğin dosyanın yayınlananla aynı olduğunu kontrol et. İndirme klasöründe PowerShell aç ve
   şunu çalıştır:

   ```powershell
   Get-FileHash .\Nobi*setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   Uzun değer, o dosya için listelenenle **birebir aynı** olmalı (büyük/küçük harf fark etmez).
   Farklıysa dosyayı çalıştırma, tekrar indir.

Sürümler henüz kod imzalı olmadığı için (bkz. [kod imzalama politikası](../CODE_SIGNING_POLICY.md))
dosyanın yayımlanan dosya olduğunu sana bu kontrol söyler.

## 3. Kurulum

1. `Nobi-x.y.z-setup.exe` dosyasına çift tıkla.
2. **"Windows bilgisayarınızı korudu"** uyarısı çıkarsa: sürümler henüz kod imzalı olmadığı için
   SmartScreen yeni dosyayı tanımıyor. Parmak izini doğruladıysan **Ek bilgi → Yine de çalıştır**'a
   tıkla.
3. Kurulum birkaç saniye sürer ve `%LOCALAPPDATA%\Nobi` klasörüne yapılır. Başlat menüsünde
   **Nobi** olarak görünür. Kurulum programı Türkçe Windows'ta Türkçe, diğer her dilde İngilizce
   konuşur.

> Sessiz kurulum için: `.\Nobi-x.y.z-setup.exe /S` (`x.y.z` yerine kendi sürümünle).

## 4. Kurulum sihirbazı (ilk açılış)

Nobi'yi Başlat menüsünden aç. Ekranın üst ortasında bir baykuş belirip seni selamlar, ardından ada
küçülür ve Nobi saatin yanındaki bildirim alanından (tepsi) nöbet tutar.

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

Nobi, Claude Code'u **hook**'lar üzerinden görür. Hook'lar `~/.claude/settings.json`
(`C:\Users\<sen>\.claude\settings.json`) dosyasına — Claude Code'un ayarlarını `CLAUDE_CONFIG_DIR`
ile başka bir klasörde tutuyorsan oradaki `settings.json`'a — eklenir. Nobi bu değişkeni yalnızca
mutlak bir yol taşıyorsa ve Nobi'nin kendisi de onu görüyorsa izler: Başlat menüsünden açılan
bir uygulama, yalnızca bir terminalin profilinde tanımlanmış bir değişkeni görmez. Bu yüzden onu
Windows hesabın için tanımla (Başlat menüsünde "ortam değişkenleri" diye arat). Nobi'nin
kullandığı dosyayı **Ayarlar → Claude Code** gösterir.

1. Sihirbazın **Bağlantı** adımında ya da **Ayarlar → Claude Code → Hook'ları kur…** ile başlat.
2. Nobi dosyada yapılacak değişikliği **fark (diff)** olarak gösterir: eklenen satırlar yeşil.
   Diğer ayarların ve başka araçların hook'ları olduğu gibi kalır. Fark dosyanın kendi metni
   üzerinden çıkarılır; yazma işlemi başka bir şeyin biçimini değiştirecekse onu da görürsün.
   Önizleme açıkken sayfadaki başka hiçbir şey yazılacak olanı değiştiremez.
3. Değişikliğe göz at ve **Onayla ve yaz**'a tıkla. Yazmadan önce aynı klasöre tarihli bir yedek
   alınır (`settings.json.bak-YYYYMMDD-HHMMSS`; henüz dosya yoksa yedek de olmaz). Yalnızca
   önizlemede gördüğün değişiklik yazılır; dosya önizlemeden sonra değiştiyse Nobi yazmayı
   reddeder ve yeni bir önizleme sunar.
4. **Ayarlar → Claude Code → Sağlık testi**'ne bas. Tüm satırlar ✓ olmalı:
   - hook'lar `settings.json`'da, `PermissionRequest` ve `PreToolUse` da aralarında,
   - relay (`nobi-hook.exe`) yerinde,
   - pipe üzerinden ping ulaşıyor (birkaç milisaniye),
   - fiziksel tıklama koruması hazır.
5. **Açık olan Claude Code oturumlarını yeniden başlat.** Claude Code hook'ları oturum başlarken
   okur.

`PreToolUse` göründüğünden önemlidir: adanın cevapladığı soruları ve planları, `PermissionRequest`'i
hiç çalıştırmayan Claude masaüstü uygulamasında da bütün onayları o taşır. Açık bırak.

### Codex, ChatGPT Work ve Cursor (isteğe bağlı)

- **Codex ve ChatGPT Work:** **Ayarlar → ChatGPT → Bağla…** aynı türden incelenmiş bir farktan sonra
  Nobi'nin hook'larını Codex'in `hooks.json` dosyasına (`$CODEX_HOME` içinde ya da `~/.codex`
  altında) yazar. Ardından hook'ları ChatGPT masaüstü uygulamasında **Ayarlar → Hooks**
  bölümünde inceleyip güvenilir olarak işaretle (liste boşsa Codex görünümünde yerel bir proje ekleyip
  listeyi yenile) ya da Codex CLI'da `/hooks` komutunu kullan. Yeni bir yerel sohbette mesaj gönder
  ve geldiğini görmek için **Sağlık testi**'ni çalıştır. Work Cloud yerel hook'ları çalıştırmaz.
- **Cursor:** **Ayarlar → Diğer ajanlar → Bağla…** `~/.cursor/hooks.json` dosyasını yazar. Nobi
  bir Cursor kabuk ya da MCP isteğine cevap vermezse — kapalı ya da duraklatılmışsa, isteği geri
  verdiysen ya da süre dolduysa — Cursor sana kendisi sorar. Ama Nobi Cursor izin hook'larını
  *güvenli tarafta kapanacak* (fail-closed) biçimde kurar: relay'in kendisi çalışamazsa Cursor
  komutu engeller. Nobi'yi kaldırmadan önce bağlantıyı kaldır (bkz. [Kaldırma](#9-kaldırma)).

## 6. Çalıştığını deneme

1. Yeni bir Claude Code oturumu başlat. Ada kısa süreliğine "oturum başladı" der; fareyi ekranın üst
   ortasına götürünce oturumunu bir satır olarak görürsün.
2. Claude'dan izin gerektiren bir şey iste, örneğin önceden izin vermediğin bir komutu çalıştırmasını.
3. Ada bir **onay kartıyla** açılır: komutun tamamı, risk seviyesi ve gerekçeler.
4. **İzin ver**'e normal şekilde tıkla. YÜKSEK ve KRİTİK isteklerde butonu çubuk dolana kadar basılı
   tut (Linux'ta bunlar terminalde onaylanır: bkz. [Linux](#linux)). Yeni açılmış bir kart bir an
   tıklama kabul etmez; böylece kazara yapılan bir çift tıklama onu onaylayamaz.

İstersen **Ayarlar → Güvenlik → Risk motorunu dene** bölümüne bir komut yazıp nasıl
puanlandığını hiçbir şey çalıştırmadan görebilirsin.

Herhangi bir yapay zekâ ajanına göndereceğin mesaj için **Ayarlar → Mesaj Atölyesi**'ni açıp hedefi
seç ve taslağını incele. Varsayılan model yerel Ollama'dır; Ollama'da **cloud** etiketli modeller
taslağı bilgisayar dışına iletebilir. OpenAI kullanmak için onu seçip anahtarını ekle; Nobi anahtarı
işletim sisteminin güvenli parola kasasında tutar. Düzenlenmiş mesajı gözden
geçirip kopyalayabilirsin; hedef uygulamaya kendin yapıştırıp gönderirsin. Nobi diğer uygulamaların
mesajlarını otomatik okumaz ya da göndermez.

## 7. Önerilen ilk ayarlar

| Ayar | Nerede | Öneri |
| --- | --- | --- |
| Windows açılınca başlat | Ayarlar → Genel | Açık — Nobi kapalıyken sorular terminale düşer. |
| Otomatik izin tavanı | Ayarlar → Güvenlik | **Sadece DÜŞÜK** (varsayılan). YÜKSEK ve KRİTİK zaten asla otomatik onaylanmaz. |
| Fiziksel tıklama koruması | Ayarlar → Güvenlik | Açık (varsayılan). Dokunmatik ekran, dizüstü dokunmatik yüzeyi ya da erişilebilirlik aracı kullanıyorsan bkz. [sorun giderme](#onay-reddedildi-fiziksel-tıklama-değil). |
| Kurallar | Ayarlar → Kurallar | Şablonlardan başla: `npm test`'e izin ver, force push yasak, `.env` dosyalarını okumasın. |
| Kısayollar | Ayarlar → Bildirimler | Ctrl+Alt+N adayı açar, Ctrl+Alt+D karttaki isteği reddeder. |
| Rahatsız etme | Adanın başlığındaki buton ya da tepsi menüsü | Sunum ya da oyun sırasında. Tam ekranda zaten kendiliğinden sessizleşir. |

**Ayarlar → Hakkında** ayarlarını bir dosyaya dışa aktarır ve bu bilgisayarda ya da başka birinde
yeniden içe aktarır. İçe aktarma yalnızca Nobi'nin kendi ayarlarını kabul eder (dışa aktarılan
dosyada `"nobiSettings": 1` bulunur); Claude Code'un `settings.json` dosyası dahil başka hiçbir
JSON'u almaz. İçe aktarma da **Varsayılanlara dön** de yerini aldıkları ayarları dosyanın yanında
`settings.json.bak-<tarih>` adıyla saklar; sıfırlama hook'larına dokunmaz ve kurulum sihirbazını
geri getirmez.

## 8. Güncelleme

Yeni sürümün kurulum programını indirip (parmak izini doğrulayarak) çalıştırman yeterli. Güncelleme
sırasında Nobi kapanır; kurulum bitince yeniden aç.

Kurulu sürümün üstüne başka bir sürüm kurmak kaldırma değil güncellemedir: ayarların, ajandan ve
geçmişin, Claude Code, Codex ve Cursor hook'ların ve **Windows açılınca başlat** hangi sürümden
güncellersen güncelle korunur. Çalıştırdığın kurulum programı 2.4.1'den yeniyse daha eski bir
sürüme dönerken de böyledir. Bunları yalnızca, zaten kurulu olan sürümü yeniden çalıştırdığında
kurulum programının gösterdiği sayfada kaldırmayı seçmek siler.

2.4.1 ve önceki sürümlerin kurulum programları bunu bilmez. Bunlardan birine dönüp her şeyi korumak
için gösterdiği sayfada **Kaldırma işlemini gerçekleştirme**'yi seç. Önceden seçili gelen **Yükleme
yapmadan önce kaldırın** ise hook'ları ve **Windows açılınca başlat**'ı kaldırır (**Uygulama
verilerini sil** kutusunu işaretlemedikçe ayarların, ajandan ve geçmişin kalır): ardından hook'ları
**Ayarlar → Claude Code**, **ChatGPT** ve **Diğer ajanlar**'dan yeniden kur ve **Windows açılınca
başlat**'ı yeniden aç.

Yeni bir sürüm hook'ların ihtiyacını değiştirirse **Ayarlar → Claude Code** (ya da **ChatGPT**,
**Diğer ajanlar**) bağlantının güncel olmadığını söyler; farkı inceleyip orada güncelle.

## 9. Kaldırma

**Ayarlar → Uygulamalar → Yüklü uygulamalar** (Windows 10'da **Uygulamalar ve özellikler**) içinde
**Nobi**'yi bulup **Kaldır**'a tıkla. Kaldırıcı:

1. Nobi açıksa kapatmanı ister — orada **İptal** hiçbir şeyi değiştirmez;
2. `nobi.exe --remove-hooks` çalıştırır; bu da `~/.claude/settings.json`'dan, Codex'in
   `hooks.json` dosyasından ve `~/.cursor/hooks.json`'dan **yalnızca Nobi'ye ait** girdileri,
   her birinin yanına tarihli bir yedek aldıktan sonra (`settings.json.bak-…`, `hooks.json.bak-…`)
   siler. Bu dosyalarda başka hiçbir şey değişmez. Onlara ekranda fark göstermeden yapılan tek yazma
   budur;
3. uygulamayı, relay'i, kayıt dosyasını, **Windows açılınca başlat** girdilerini ve
   [ChatGPT Web köprüsünü](../integrations/chatgpt-web/README.tr.md) kurduysan onun Chrome ve
   Edge'deki kaydını siler.

Hook'lar kaldırılamazsa (örneğin salt okunur ya da kilitli bir dosya yüzünden) kaldırıcı relay'i ve
kayıt dosyasını yerinde bırakır; böylece Claude Code, Codex ve Cursor çalışmaya devam eder. Hangi
girdileri elle sileceğini de gösterir; neyin ters gittiğini kayıt dosyası söyler.
`nobi.exe --remove-hooks` konsol penceresi açmaz, bu yüzden yazdığı hiçbir şey görünmez:
temizlediği ya da temizleyemediği her dosyayı `%LOCALAPPDATA%\Nobi\nobi.log` dosyasına not
eder, çıkış kodunu da kaldırıcı okur — temizleyemediği bir dosya olursa 1, Nobi'ye ait hiçbir
girdi kalmadıysa 0. Kendin çalıştırıp bu kodu görmek istersen PowerShell'de şöyle başlat:

```powershell
(Start-Process "$env:LOCALAPPDATA\Nobi\nobi.exe" -ArgumentList '--remove-hooks' -Wait -PassThru).ExitCode
```

Ayarların ve ajandan (`%APPDATA%\Nobi`) ve geçmişin (`%LOCALAPPDATA%\Nobi\audit.jsonl`)
kalır; yeniden kurarsan kaldığın yerden devam eder. `%APPDATA%\Nobi`, `%LOCALAPPDATA%\Nobi`
ve WebView'ün kendi klasörlerini de silmek için kaldırıcıda **Uygulama verilerini sil** kutusunu
işaretle.

Her değişikliği incelemek istersen önce bağlantıları **Ayarlar → Claude Code → Kaldır…**,
**Ayarlar → ChatGPT → Bağlantıyı kaldır…** ve **Ayarlar → Diğer ajanlar → Bağlantıyı kaldır…** ile
kaldır.

ChatGPT Web köprüsünü kurduysan eklentisini de `chrome://extensions` ya da `edge://extensions`
sayfasından kaldır. 2.4.1 ve önceki sürümlerin kaldırıcıları köprünün kaydını geride bırakır: bu
sürümlerden birini kaldırmadan önce `integrations\chatgpt-web` klasöründe PowerShell'de kayıt
silme betiğini çalıştır. Betik kaydı Chrome ve Edge için kaldırır ve manifest dosyalarını siler:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister-windows.ps1
```

## 10. Dosyalar nerede?

| Ne | Nerede |
| --- | --- |
| Uygulama | `%LOCALAPPDATA%\Nobi\` |
| Relay | `%LOCALAPPDATA%\Nobi\bin\nobi-hook.exe` |
| Ayarlar | `%APPDATA%\Nobi\settings.json` |
| Ajanda | `%APPDATA%\Nobi\agenda.json` |
| Geçmiş | `%LOCALAPPDATA%\Nobi\audit.jsonl` (+ `audit.1.jsonl`) |
| Kayıt (log) | `%LOCALAPPDATA%\Nobi\nobi.log` |
| Claude Code hook'ları | `%USERPROFILE%\.claude\settings.json` (yedekler: `settings.json.bak-*`) |
| Codex hook'ları | `%CODEX_HOME%\hooks.json` ya da `%USERPROFILE%\.codex\hooks.json` (yedekler: `hooks.json.bak-*`) |
| Cursor hook'ları | `%USERPROFILE%\.cursor\hooks.json` (yedekler: `hooks.json.bak-*`) |

**Ayarlar → Hakkında** sayfasındaki butonlar bu dosyaları Dosya Gezgini'nde gösterir.

## 11. Sorun giderme

### Ada oturumlarımı göstermiyor

- **Ayarlar → Claude Code → Sağlık testi**'ni çalıştır ve ✗ olan satırı oku.
- Hook'ları kurduktan sonra **Claude Code oturumunu yeniden başlattın mı?** Açık oturumlar yeni
  hook'ları görmez.
- Claude Code WSL içinde mi çalışıyor? O zaman ayarları Linux tarafında durur; Nobi aynı sistemde
  çalışan Claude Code'u izler — Nobi'yi Linux tarafına kur (WSLg penceresini gösterir) ya da
  Claude Code'u Windows'ta çalıştır.
- Hook'lar sonradan silindiyse Nobi açılışta "hook'lar kaldırılmış" uyarısı verir;
  **Ayarlar → Claude Code**'dan yeniden kur.

### Sağlık testi: "Relay bulunamadı"

Nobi'yi kapatıp yeniden aç; relay her açılışta yerine kopyalanır. Antivirüs yazılımın
`%LOCALAPPDATA%\Nobi\bin\nobi-hook.exe` dosyasını karantinaya aldıysa geri yükle ve istisna
ekle. Relay eksikken Nobi hook kurmaz, çünkü o zaman her hook hata verirdi.

### Sağlık testi: "Ping pipe'a ulaşmadı"

Nobi'nin çalıştığından emin ol (tepside baykuş). Başka bir güvenlik yazılımı named pipe'ları
engelliyor olabilir. Sorun sürerse `%LOCALAPPDATA%\Nobi\nobi.log` dosyasındaki son satırlarla
bir issue aç.

### Onay reddedildi: fiziksel tıklama değil

Kartta *"Onay fiziksel bir tıklamadan gelmedi ve reddedildi"* yazıyor ama sen tıkladın.
Fiziksel tıklama koruması, onayın butonun üzerinde yapılmış gerçek bir fare basışından geldiğini
doğrular. Şunlar "gerçek fare basışı" üretmeyebilir:

- dokunmatik ekran ya da kalem,
- uzak masaüstü / uzaktan kontrol yazılımları,
- ekran klavyesi, sesli kontrol gibi erişilebilirlik araçları.

Bunlardan birini kullanıyorsan **Ayarlar → Güvenlik → Fiziksel tıklama koruması**'nı kapat. Koruma
o zaman DÜŞÜK ve ORTA onayları denetlemeyi bırakır; YÜKSEK ve KRİTİK onaylar her zaman gerçek bir
basış ve basılı tutma ister. Bunu yapamadığında o istekleri terminalde karara bağla (**Terminale
bırak**).

**Dizüstü dokunmatik yüzeyinde:** Bazı Windows dizüstülerinin hassas dokunmatik yüzeyleri basışı,
geldiği aygıtın adını vermeden bildirir; bir programın sahte tıklaması da tam böyle görünür, bu yüzden
Nobi onu reddeder. Dokunmatik yüzeyle yaptığın tıklama reddediliyorsa
`%LOCALAPPDATA%\Nobi\nobi.log` dosyasında *a press without a device handle counts as
synthetic* diye başlayan bir satır ara. Varsa bir fareyle onayla ya da korumayı yukarıdaki gibi
kapat. Korumanın bu aygıtı tanımayı öğrenebilmesi için dizüstünün modeliyle bir issue da aç.

Normal bir fareyle tıkladığın hâlde reddediliyorsa lütfen bir issue aç; bu bir hata olur. Fare
düğmelerini yer değiştirdiysen (solak kullanım) koruma seçtiğin birincil düğmeyi izler.

> Bu uyarıyı **sen tıklamadığın hâlde** görüyorsan, bilgisayarındaki bir program senin yerine
> onaylamaya çalışmış demektir. İsteği reddet ve o sırada ne çalıştığını kontrol et.

### Kısayollar çalışmıyor

**Ayarlar → Bildirimler → Kısayollar** her kısayolun durumunu gösterir. "Kaydedilemedi" yazıyorsa
başka bir uygulama aynı tuşları kullanıyordur; farklı bir kombinasyon seç.

### Ses ya da bildirim gelmiyor

Rahatsız etme, sessiz saatler ya da tam ekran sessizliği açık olabilir (adanın başlığında yazar).
Başlangıcı ve bitişi aynı olan sessiz saatler hiç uygulanmaz. Windows'un **Odaklanma / Rahatsız
etmeyin** modu da Nobi bildirimlerini gizler. Varsayılan ayarlarla Nobi bildirimi yalnızca ada
açık değilken gönderir (**Ayarlar → Bildirimler**).

### Ada yanlış ekranda ya da bir şeyin üstünü kapatıyor

**Ayarlar → Genel**'den **Konum** (sol / orta / sağ) ve **Ekran** (ana ekran / imlecin olduğu
ekran) ayarlarını değiştir.

### Cursor her komutta soruyor ya da her komutu engelliyor

Nobi bir Cursor isteğine cevap vermezse — kapalı ya da duraklatılmışsa, isteği geri verdiysen ya
da süre dolduysa — Cursor sana kendisi sorar. Bu beklenen davranış. Cursor her kabuk ve MCP komutunu
*engelliyorsa*, hook'ları çalışamayan bir relay'i gösteriyordur; çoğunlukla Nobi, Cursor
bağlantısı kaldırılmadan silindiği içindir: Nobi'yi yeniden kurup **Ayarlar → Diğer ajanlar →
Bağlantıyı kaldır…**'ı kullan ya da `~/.cursor/hooks.json` dosyasından `nobi-hook` geçen
girdileri sil (veya `hooks.json.bak-*` yedeklerinden birini geri yükle).

### Claude masaüstü uygulamasında komutlar adayı bekliyor

Claude masaüstü uygulaması Claude Code'un `PermissionRequest` hook'unu hiç çalıştırmaz; bu yüzden
Nobi `PreToolUse` üzerinden sorar. Bu hook uygulamanın kendi izin denetiminden önce çalıştığı
için Claude izin kurallarının zaten izin verdiği komutlar da adayı bekler; kimse cevap vermezse
uygulama en fazla 108 saniye sonra normalde nasıl davranacaksa öyle devam eder. Bir masaüstü
oturumunu başında kimse olmadan çalışmaya bırakmadan önce Nobi'yi tepsiden duraklat (istekler o
zaman doğrudan geri döner) ya da DÜŞÜK istekleri güvenilir bir proje veya kurallarla geçir.

### Ayarlarım sıfırlandı ve bir `.unreadable-…` dosyası belirdi

Nobi `settings.json`'ı olduğu gibi kullanamazsa (JSON'u bozan ya da bir ayara yanlış türde değer
yazan bir elle düzenleme, bir disk hatası) varsayılan ayarlarla — yalnızca bazı değerler
okunamıyorsa okuyabildiği her değerle — açılır, dosyayı yanına `settings.json.unreadable-<tarih>`
adıyla kopyalar ve ne olduğunu söylemek için Ayarlar'ı açar. Yeniden başlatana kadar asıl dosyanın
üzerine kaydetmez. Dosyayı düzelt ya da geri yükle, sonra Nobi'yi yeniden başlat.

`agenda.json` için de aynı özen gösterilir. Bir bayt sırası işareti (BOM) ya da bozuk bir öğe
yalnızca o öğeyi kaybettirir; dosya olduğu gibi korunamıyorsa herhangi bir kayıttan önce
`agenda.json.unreadable-<tarih>` adıyla kopyalanır; var olan ama okunamayan (kilitli ya da izni
olmayan) bir dosyanın üzerine asla yazılmaz: dosya yeniden okunabilene kadar öğe eklemek ya da
değiştirmek bir mesajla reddedilir. Ajanda en çok 300 öğe tutar; dolunca yeni öğeye en eski
tamamlanmış öğe yer açar, tamamlanmış öğe yoksa yeni öğe bir mesajla reddedilir.

### Windows açılınca başlat kendiliğinden kapandı

Nobi her açılışta Windows'un kendi kaydına bakar. Nobi'yi Görev Yöneticisi'nin **Başlangıç
uygulamaları** sekmesinden (Windows 10'da **Başlangıç**) kapattıysan ya da başka bir şey kaydı
sildiyse **Ayarlar → Genel → Windows açılınca başlat** senin seçimini ezmek yerine ona uyar ve
kapanır. İstersen oradan yeniden aç.

### "Hook'lar yalnızca Claude Code'un Git Bash kullandığı yerde çalışır"

Claude Code hook'ları Git Bash'te, Git Bash'i bulamazsa PowerShell'de çalıştırır (Claude masaüstü
uygulaması çoğu zaman bulamaz). Nobi hook komutunu ikisinde de çalışacak şekilde yazar; ama
relay'in kullanıcı klasörünün altındaki yolunda iki kabuktan da geçemeyen karakterler varsa — `$`,
ters tırnak, kesme işareti, parantez gibi işaretler ya da kısa (8.3) adlar tutmayan bir sürücüde
boşluk — hook'lar yalnızca Git Bash için yazılır, **Ayarlar → Claude Code** bunu söyler ve
`nobi.log` her açılışta not eder. Git for Windows kuruluyken terminalde ya da VS Code'da çalışan
Claude Code yine Nobi'ye ulaşır; hook'ların PowerShell'de çalıştığı yerde, örneğin masaüstü
uygulamasında, istekler ulaşmaz.

### Ada odağı alıyor ya da Alt-Tab'da görünüyor

Bunu yapmamalı: Windows'ta ada ve masaüstü maskotu Alt-Tab'da ve Görev Görünümü'nde yer almaz,
onlara tıklamak terminalini ya da editörünü etkin bırakır. Klavyeyi yalnızca adanın yazı kutuları —
asistan, oturum araması, ajanda ve soru ile plan kartlarındaki cevap ve not kutuları — sen içlerine
yazarken alır. Başka türlü görüyorsan lütfen Windows sürümünle bir issue aç.

### Windows Defender kurulum programını işaretledi

İmzasız yeni programlarda makine öğrenmesi tabanlı yanlış pozitifler görülebilir. Önce parmak izini
`SHA256SUMS.txt` ile doğrula. Eşleşiyorsa bir issue aç; dosyayı Microsoft'a yanlış pozitif olarak
bildirmek de yardımcı olur.

### Nobi'yi elle sildim, Claude Code her adımda hook hatası veriyor

Hook'lar artık olmayan bir dosyayı gösteriyor. En kolayı Nobi'yi yeniden kurup **Ayarlar → Claude
Code → Kaldır…** (bağladıysan ChatGPT ve Diğer ajanlar altındaki **Bağlantıyı kaldır…**) ile
hook'ları silmek ya da normal yoldan kaldırmak. Alternatif olarak
`~/.claude/settings.json.bak-*` yedeklerinden birini geri yükleyebilirsin.

### Daha fazla yardım

- Kayıt dosyası: `%LOCALAPPDATA%\Nobi\nobi.log`
- Hata bildirimi: [Issues](https://github.com/tahap0l/nobi/issues)
- Güvenlik açığı: herkese açık issue yerine [özel bildirim](https://github.com/tahap0l/nobi/security/advisories/new)
  ([SECURITY.md](../SECURITY.md))

## 12. Kaynaktan derleme

Gerekenler: MSVC araç zinciriyle [Rust](https://rustup.rs), Node.js 22+, "Desktop development with
C++" iş yüküyle [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

```powershell
git clone https://github.com/tahap0l/nobi.git
cd nobi
npm ci
npm test          # Rust testleri (relay'i de derler)
npm run pack      # → release\Nobi-<sürüm>-setup.exe
```

Mac'te: Xcode Command Line Tools (`xcode-select --install`), iki Apple hedefiyle Rust
(`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) ve Node.js 22 ya da üstünü kur;
sonra `npm ci`, `npm test` ve `npm run pack:mac` (→ `release/Nobi-<sürüm>-macos-universal.dmg`).

Linux'ta: Rust, Node.js 22 ya da üstü ve [README](../README.tr.md#kaynaktan-derleme)'deki
geliştirme paketleri; sonra `npm ci`, `npm test` ve `npm run pack:linux`.

Uygulamayı bu betiklerle ya da `npm run tauri build` ile derle. Yalnızca `cargo build --release`
bir geliştirme derlemesi üretir: sayfalarını `http://localhost:1420` adresindeki geliştirme
sunucusundan yükler, sunucu yoksa adada yalnızca "Could not connect to localhost" görünür.
Uygulamayı elle nasıl derleyeceğin [CONTRIBUTING.md](../CONTRIBUTING.md#setting-up)'de (İngilizce)
anlatılıyor. Ayrıntılar için [CONTRIBUTING.md](../CONTRIBUTING.md).

## macOS

Kurulum sihirbazı, Claude Code'a bağlama, deneme,
önerilen ayarlar ve sorun gidermenin çoğu (4–7. ve 11. bölümler) Mac'te de aynı. Bu bölüm farklı
olanları anlatır.

### Gereksinimler

| | |
| --- | --- |
| macOS | 11 Big Sur ya da üstü; Apple Silicon ya da Intel (tek, universal uygulama) |
| Claude Code | Doğrudan Mac'te çalışan: Terminal, iTerm2, VS Code, Cursor, Claude masaüstü uygulaması… |
| Yetki | Bir uygulamayı Uygulamalar klasörüne sürüklemekten fazlası gerekmez |

### İndirme ve doğrulama

1. [Son sürüm sayfasından](https://github.com/tahap0l/nobi/releases/latest)
   `Nobi-x.y.z-macos-universal.dmg` ve `SHA256SUMS.txt` dosyalarını indir.
2. İndirdiğini Terminal'de doğrula:

   ```sh
   cd ~/Downloads
   shasum -a 256 Nobi*macos-universal.dmg
   grep macos SHA256SUMS.txt
   ```

   Değer, o dosya için listelenenle aynı olmalı. Farklıysa dosyayı açma, tekrar indir.

### Kurulum ve ilk açılış

1. Disk görüntüsünü aç, baykuşu **Uygulamalar** (Applications) klasörüne sürükle, sonra disk
   görüntüsünü çıkar. (Finder uygulamayı Nobi ya da Nobi diye gösterebilir; diskte her zaman
   `/Applications/Nobi.app` olarak durur.)
2. Uygulamayı Uygulamalar'dan ya da Spotlight'tan aç. Sürümler henüz Apple tarafından
   onaylanmadığı (notarize edilmediği) için macOS ilk seferde durdurur:
   - **macOS 15 Sequoia ve sonrası:** Apple'ın uygulamanın zararlı yazılım içermediğini
     doğrulayamadığını söyleyen bir mesaj çıkar. **Bitti**'yi seç. **Sistem Ayarları → Gizlilik
     ve Güvenlik**'i aç, uygulamanın Mac'ini korumak için engellendiğini söyleyen satıra in, **Yine
     de Aç**'a tıkla, parolan ya da Touch ID ile onayla ve bir kez daha **Yine de Aç**'ı seç.
   - **macOS 14 ve öncesi:** Uygulamalar'da uygulamaya Control tuşuyla tıkla, **Aç**'ı seç, sonra
     yine **Aç**'ı seç.

   Bunu bir kez, bir de her güncellemeden sonra yaparsın.
3. **"… hasarlı ve açılamıyor" mu diyor?** Gerçek bir hasar değil, indirmenin karantina işareti.
   SHA-256'yı doğruladıktan sonra Terminal'de işareti kaldırıp tekrar aç:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Nobi.app
   ```

   (Bir ajan bu komutu çalıştırmak isterse Nobi onu KRİTİK sayar, çünkü Nobi'nin kendi
   uygulamasını değiştirir — burada az önce doğruladığın bir uygulama için bunu yapan sensin.)
4. macOS sorduğunda bildirimlere izin ver. Sonradan **Sistem Ayarları → Bildirimler**'den
   değiştirebilirsin.

Baykuş menü çubuğunun hemen altında selam verir ve kurulum sihirbazı açılır —
[4. bölümden](#4-kurulum-sihirbazı-ilk-açılış) devam et.

### Mac'te neler farklı

- **Menü çubuğu uygulaması.** Dock'ta simgesi yok, ⌘-Sekme'de görünmez; Nobi'nin menüsü menü
  çubuğunda, menü çubuğunun açık ya da koyu görünümüne uyan bir baykuşun altında.
- **Ada menü çubuğunun altında durur.** Çentikli MacBook'larda kamera çıkıntısının arkasında
  hiçbir şey kaybolmaz.
- **Kısayollar.** Ctrl, ⌃ Control; Alt, ⌥ Option tuşudur. Varsayılanlar ⌃⌥N (adayı aç) ve ⌃⌥D
  (reddet). Kendi kısayollarında ⌘ da kullanabilirsin. macOS kısayolu tuşun yerine bağlar; bu
  yüzden harfler ABD klavyesindeki adlarıyla görünür.
- **Pencereye git**, oturumun uygulamasını (Terminal, iTerm2, VS Code…) öne getirir; belirli bir
  pencereyi ya da sekmeyi değil.
- **Ada hiç odak almaz.** Yüzen bir paneldir: ona tıklamak terminalini etkin uygulama olarak
  bırakır. Klavyeyi yalnızca yazı kutuları (asistan, oturum araması, ajanda ve soru ile plan
  kartlarındaki cevap ve not kutuları), sen içlerine yazarken alır.
- **Tam ekranda sessizlik** Windows'taki gibi çalışır: önde tam ekran bir video, oyun ya da sunum
  varken Nobi sessiz kalır.
- **Medya kartı** Spotify ya da Müzik açıkken onları gösterir. İlk seferde macOS, Nobi'nin o
  uygulamayı yönetip yönetemeyeceğini sorar (**Sistem Ayarları → Gizlilik ve Güvenlik →
  Otomasyon**). Kapalı bir oynatıcı asla başlatılmaz.
- **Tıklama koruması**, onay tıklamasının gerçek bir fareden ya da trackpad'den geldiğini
  denetler: macOS her fare olayına onu kimin ürettiğini yazar. Bir program ancak ona Erişilebilirlik
  izni verdiysen (**Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik**) tıklama taklit
  edebilir; o listeyi kısa tut.
- **Oturum açınca başlat**, Nobi için bir LaunchAgent ekler.

### Güncelleme

Yeni disk görüntüsünü indirip doğrula, Nobi'den menü çubuğundan çık, yeni uygulamayı
Uygulamalar'a sürükle ve **Değiştir**'i seç. **Yine de Aç**'ı bir kez daha onaylaman gerekebilir.
Ayarların, ajandan, geçmişin ve hook'ların korunur. 2.4.1 ya da daha eski bir sürümden geliyorsan
masaüstü maskotu bir kereliğine yer değiştirebilir ya da köşesine dönebilir: konumu artık nokta
(point) cinsinden tutuluyor; bu, ölçeklemesi farklı ekranlarda da doğru kalır.

### Kaldırma

Nobi'nin hook'ları başka programların ayar dosyalarında durur; uygulamayı silmeden önce onları
çıkar. Relay yerinde durduğu sürece unutulan bir hook zarar vermez; ama relay silinince Claude Code
her adımda hook hatası bildirir, izin hook'ları güvenli tarafta kapanan (fail-closed) Cursor da her
kabuk ve MCP komutunu engeller.

1. Terminal'de şunu çalıştır:

   ```sh
   /Applications/Nobi.app/Contents/MacOS/nobi --remove-hooks
   ```

   Bu, `~/.claude/settings.json`'dan, Codex'in `hooks.json` dosyasından ve `~/.cursor/hooks.json`'dan
   yalnızca Nobi'nin kendi girdilerini, her birinin yanına tarihli bir yedek bırakarak siler ve
   fark göstermez. (Bir ajan onu çalıştırmak isterse Nobi bunu KRİTİK sayar — burada çalıştıran
   sensin.) Her değişikliği incelemek istersen **Ayarlar → Claude Code → Kaldır…**, **Ayarlar →
   ChatGPT → Bağlantıyı kaldır…** ve **Ayarlar → Diğer ajanlar → Bağlantıyı kaldır…** düğmelerini
   kullan.
2. **Oturum açınca başlat** açıksa **Ayarlar → Genel**'den kapat.
3. Nobi'den menü çubuğundan çık ve uygulamayı Uygulamalar'dan Çöp Sepeti'ne taşı.
4. Hiç iz kalmasın istiyorsan `~/Library/Application Support/Nobi` klasörünü de sil.

### Dosyalar nerede?

| Ne | Nerede |
| --- | --- |
| Uygulama | `/Applications/Nobi.app` |
| Ayarlar | `~/Library/Application Support/Nobi/settings.json` |
| Ajanda | `~/Library/Application Support/Nobi/agenda.json` |
| Geçmiş | `~/Library/Application Support/Nobi/audit.jsonl` (+ `audit.1.jsonl`) |
| Kayıt (log) | `~/Library/Application Support/Nobi/nobi.log` |
| Relay | `~/Library/Application Support/Nobi/bin/nobi-hook` |
| Relay soketi | `~/Library/Application Support/Nobi/nobi.sock` |
| Claude Code hook'ları | `~/.claude/settings.json` (yedekler: `settings.json.bak-*`) |
| Codex ve Cursor hook'ları | `$CODEX_HOME/hooks.json` ya da `~/.codex/hooks.json`; `~/.cursor/hooks.json` (yedekler: `hooks.json.bak-*`) |

Finder `~/Library` klasörünü gizler: **Git → Klasöre Git…** (⇧⌘G) ile yolu yapıştır ya da
**Ayarlar → Hakkında**'daki butonları kullan.

### Mac'te sorun giderme

- **Ada oturumlarımı göstermiyor.** [11. bölümdeki](#11-sorun-giderme) gibi sağlık testini
  çalıştır ve Claude Code oturumunu yeniden başlat.
- **Onay reddedildi: fiziksel tıklama değil.** Ekran Paylaşımı ve diğer uzaktan kontrol araçları,
  Universal Control (başka bir Mac'in klavye ve faresi) ve Sesle Denetim ya da Anahtar Denetimi
  gibi erişilebilirlik araçları, macOS'un "bir programdan geldi" diye işaretlediği tıklamalar
  gönderir. Mac'in kendi faresini ya da trackpad'ini kullan veya **Ayarlar → Güvenlik → Fiziksel
  tıklama koruması**'nı kapat (yalnızca DÜŞÜK ve ORTA için; YÜKSEK ve KRİTİK her zaman gerçek bir
  basılı tutma ister). Sıradan bir trackpad tıklaması reddediliyorsa lütfen bir issue aç.
- **Bildirim gelmiyor.** **Sistem Ayarları → Bildirimler**'den izin ver; bir Odak modu da
  bildirimleri gizleyebilir.
- **Medya kartı bir şey göstermiyor ya da oynatıcıyı yönetemiyor.** **Sistem Ayarları → Gizlilik
  ve Güvenlik → Otomasyon**'dan Nobi'ye izin ver.
- **Kısayollar çalışmıyor.** **Ayarlar → Bildirimler → Kısayollar**, bir kombinasyonu başka bir
  uygulamanın kullanıp kullanmadığını gösterir.
- **Ada istediğim ekranda değil.** **Ayarlar → Genel**'den **Ekran**'ı değiştir.
- **Oturum açınca başlat kendiliğinden kapandı.** Nobi her açılışta oturum açılış kaydına bakar;
  Nobi dışında bir şey onu kaldırdıysa **Ayarlar → Genel**'deki anahtar da buna uyup kapanır.
  Oradan yeniden aç.

## Linux

Kurulum sihirbazı, Claude Code'a bağlama, deneme, önerilen ayarlar ve sorun gidermenin çoğu
(4–7. ve 11. bölümler) Linux'ta da aynı.

### Gereksinimler

| | |
| --- | --- |
| Dağıtım | WebKitGTK 4.1 olan x86-64: Ubuntu 22.04+, Debian 12+, Fedora 38+, Arch… |
| Masaüstü | X11 ya da XWayland üzerinden Wayland (GNOME, KDE Plasma, Xfce, Cinnamon…) — bkz. [Wayland](#wayland) |
| Bileşikleştirici | X11'de bileşikleştirme yapan bir pencere yöneticisi: ada saydam bir penceredir. GNOME, KDE Plasma ve Cinnamon'da hazır gelir; Xfce'de pencere yöneticisinin ince ayarlarındaki (**Window Manager Tweaks**) **Compositor** sekmesinden aç; yalın bir pencere yöneticisinde `picom` gibi birini çalıştır. Yoksa Nobi penceresini adanın kendisine (köşeler kare, gölge yok), masaüstü maskotunun penceresini de maskota ve çevresindeki dar bir kenara kırpar |
| Tepsi | GNOME'da AppIndicator eklentisi gerekir (Ubuntu'da zaten var); diğer masaüstlerinin çoğunda tepsi var |

### Kurulum

[Son sürümden](https://github.com/tahap0l/nobi/releases/latest) `.deb` ya da AppImage ile
`SHA256SUMS.txt` dosyasını indir ve indirme klasöründe doğrula:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

İndirdiğin her dosya için `OK` yazmalı. Sonra ya paketi kur:

```sh
sudo apt install ./Nobi-x.y.z-linux-amd64.deb
```

ya da AppImage'ı çalıştırılabilir yapıp aç:

```sh
chmod +x Nobi-x.y.z-linux-amd64.AppImage
./Nobi-x.y.z-linux-amd64.AppImage
```

### Linux'ta neler farklı

- **Pencere X11 üzerinden çalışır.** Wayland'de Nobi kendini XWayland'de başlatır; böylece ada
  ekranın üstüne yerleşip diğer pencerelerin üstünde kalabilir. Senin için açtığı programlar —
  tarayıcıda bir bağlantı, VS Code, dosya yöneticisi — her zamanki gibi, doğrudan Wayland'de açılır;
  AppImage'dan açıldıklarında da AppImage'ın kendisi için kurduğu ayarları (GTK teması ve
  modülleri, GStreamer eklentileri) değil, masaüstünün kendi ayarlarını alırlar.
- **Ada klavyeyi almaz.** Ona tıklamak terminalini odakta bırakır; klavyeyi yalnızca yazı kutuları
  (asistan, oturum araması, ajanda ve soru ile plan kartlarındaki cevap ve not kutuları), sen
  içlerine yazarken alır. Kutudan çıkınca — onu kapatınca ya da ada katlanınca — klavye önceden
  kendisinde olan pencereye geri döner.
- **YÜKSEK ve KRİTİK terminalde onaylanır.** X11, senin hesabınla çalışan her programın gerçek fare
  üzerinden tıklamasına izin verir ve böyle bir tıklamayı seninkinden ayıran hiçbir şey yoktur; bu
  yüzden ada Linux'ta YÜKSEK ya da KRİTİK bir isteği asla onaylamaz. Kartı nedenini söyler ve
  **Terminale bırak** (Cursor isteğinde **Cursor'a bırak**) ile **Reddet** sunar: cevabı terminalde
  ya da Cursor'da ver. DÜŞÜK ve ORTA istekler her yerde olduğu gibi adada onaylanır.
- **Tıklama koruması** XInput2 ham olaylarını okur ve her basışta arkasındaki aygıtı X sunucusuna
  sorar: XTEST aygıtından gelen tıklamalar — `xdotool` gibi araçların kullandığı, bir programın
  sonradan eklediği dahil — reddedilir. Gerçek fare aygıtı üzerinden basan bir programı
  yakalayamaz; bu yüzden burada yalnızca DÜŞÜK ve ORTA onayları korur.
- **Pencereye git**, pencere yöneticisinden oturumun süreç zincirine ait pencereyi öne getirmesini
  ister.
- **Medya kartı** MPRIS destekleyen her oynatıcıyla çalışır — Spotify, VLC, Firefox, Chromium,
  MPRIS eklentili mpv. Yalnızca zaten çalışan bir oynatıcıyla konuşur; hiçbirini kendisi başlatmaz.
- **Sesle yazma yok.** Linux'ta sistem dikte özelliği olmadığı için asistanda 🎙 düğmesi yok.
- **Bildirimler** bir komutu, bildirim sunucusu biçimlendirme okusa bile düz metin olarak gösterir:
  içindeki hiçbir şey bağlantıya dönüşemez.
- **Gizli bilgiler** (isteğe bağlı OpenAI anahtarı) Secret Service'e (GNOME Keyring, KWallet) gider.

### Wayland

Bir Wayland oturumunda (güncel Ubuntu, Fedora ve KDE Plasma'nın varsayılanı) Nobi'nin penceresi
XWayland'de çalışır ve yalnızca X11'in ona gösterdiğini görür:

- **Genel kısayollar** yalnızca bir X11 (XWayland) penceresi odaktayken çalışır. Önde yerel bir
  Wayland penceresi varken tepsi menüsünü kullan ya da adaya tıkla.
- **Pencereye git**, doğrudan Wayland'de çalışan terminalleri ve editörleri (GNOME Terminal,
  Konsole ve daha birçoğu) bulamaz; onun yerine oturumun klasörünü açar.
- **Tam ekranda sessizlik**, tam ekrandaki yerel Wayland uygulamalarını fark etmez. Sunumlar için
  Rahatsız etme'yi kullan.
- **Tıklama koruması** X11 programlarının XTEST tıklamalarını yine reddeder. Ama bileşikleştiricinin
  kendisinin ürettiği girdi XWayland'e sıradan işaretçi girdisi olarak ulaşır. GNOME ve KDE bunu
  ancak bir uzak masaüstü onayından sonra yapar; wlroots tabanlı bileşikleştiriciler (sway, Hyprland,
  river…) ise sanal işaretçi protokolleriyle her programın girdi üretmesine izin verir ve orada
  koruma böyle bir tıklamayı seninkinden ayıramaz.

Masaüstün sunuyorsa bir X11 oturumuyla giriş yapmak bu dördünü de ortadan kaldırır. YÜKSEK ve
KRİTİK istekler X11'de de terminalde onaylanır.

### Güncelleme

Yeni dosyaları indirip yukarıdaki gibi doğrula. Nobi'den tepsiden çık, sonra yeni `.deb`'i
`sudo apt install ./Nobi-x.y.z-linux-amd64.deb` ile kur ya da AppImage'ı değiştir. **Oturum
açınca başlat** açıksa ve yeni AppImage'ın dosya adı farklıysa yenisini bir kez elle aç: Nobi
oturum açılış kaydını başlatıldığı AppImage'a yönlendirir. Kaydın `Exec=` satırında yalnızca bu yol
değişir; onun çevresine senin eklediklerin (`env …`, `--minimized`) kalır, oraya kendi yazdığın
bir sarmalayıcı betik koyduysan ona dokunulmaz. Ayarlar, ajanda, geçmiş ve hook'lar korunur.

### Kaldırma

Paket yöneticisi root olarak çalışır ve hook'ları ev klasöründen çıkaramaz; bunu önce sen yap. Relay
yerinde durduğu sürece unutulan bir hook zarar vermez; ama relay silinince Claude Code her adımda
hook hatası bildirir, Cursor da her kabuk ve MCP komutunu engeller.

1. Hook'ları kaldır:

   ```sh
   nobi --remove-hooks                                # .deb
   ./Nobi-x.y.z-linux-amd64.AppImage --remove-hooks   # AppImage
   ```

   Bu, `~/.claude/settings.json`'dan, Codex'in `hooks.json` dosyasından ve `~/.cursor/hooks.json`'dan
   yalnızca Nobi'nin kendi girdilerini, her birinin yanına tarihli bir yedek bırakarak siler ve
   fark göstermez. (Bir ajan onu çalıştırmak isterse Nobi bunu KRİTİK sayar — burada çalıştıran
   sensin.) Her değişikliği incelemek istersen **Ayarlar → Claude Code → Kaldır…**, **Ayarlar →
   ChatGPT → Bağlantıyı kaldır…** ve **Ayarlar → Diğer ajanlar → Bağlantıyı kaldır…** düğmelerini
   kullan.
2. **Oturum açınca başlat** açıksa **Ayarlar → Genel**'den kapat
   (`~/.config/autostart/Nobi.desktop` dosyasıdır).
3. Nobi'den tepsiden çık, sonra `sudo apt remove nobi` çalıştır ya da AppImage'ı sil.
4. Hiç iz kalmasın istiyorsan `~/.config/nobi`, `~/.local/share/nobi` ve
   `~/.local/state/nobi` klasörlerini de sil.

### Dosyalar nerede?

| | |
| --- | --- |
| Ayarlar ve ajanda | `~/.config/nobi` (tanımlıysa `$XDG_CONFIG_HOME/nobi`) |
| Geçmiş, günlük ve relay | `~/.local/share/nobi` (tanımlıysa `$XDG_DATA_HOME/nobi`) |
| Relay soketi | `~/.local/state/nobi/nobi.sock` (yedek olarak `/tmp/nobi-<uid>/`) |
| Oturum açınca başlat | `~/.config/autostart/Nobi.desktop` |
| Uygulama (`.deb`) | `/usr/bin/nobi` |
| Claude Code, Codex ve Cursor hook'ları | `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` ya da `~/.codex/hooks.json`, `~/.cursor/hooks.json` |

### Linux'ta sorun giderme

- **Ekranın üstünde siyah bir kutu ya da kare köşeler.** Bileşikleştirici yok, bu yüzden ada
  saydam olamıyor. 2.4.1'den sonraki sürümler pencereyi adanın kendisine (köşeler kare, gölge
  yok), masaüstü maskotunun penceresini de maskota ve çevresindeki dar bir kenara kırpar ve
  bunu kayıt dosyasına bir kez yazar. Masaüstünün bileşikleştiricisini aç ya da bir tane başlat
  (`picom`, `xcompmgr`); Nobi tam görünüme kendiliğinden geçer.
- **GNOME'da tepsi simgesi yok.** AppIndicator eklentisini kur ve etkinleştir.
- **AppImage'dan ses gelmiyor.** 2.4.1'e kadarki AppImage'lar GStreamer ses eklentilerini taşımaz;
  sonrakiler taşır. `.deb`'i ya da daha yeni bir AppImage'ı kullan.
- **Kısayollar, Pencereye git ya da tam ekran sessizliği çalışmıyor.** Büyük olasılıkla
  Wayland'desin: bkz. [Wayland](#wayland).
- **Oturum açınca başlat kendiliğinden kapandı.** Nobi her açılışta
  `~/.config/autostart/Nobi.desktop` dosyasına bakar; masaüstünün otomatik başlatma ayarları onu
  kaldırdıysa ya da kapattıysa (`Hidden=true`, `X-GNOME-Autostart-enabled=false`) **Ayarlar →
  Genel**'deki anahtar da buna uyup kapanır. Oradan yeniden aç.
- **YÜKSEK ya da KRİTİK bir kartta İzin ver düğmesi yok.** Linux'ta bu bilerek böyle (bkz.
  [Linux'ta neler farklı](#linuxta-neler-farklı)): **Terminale bırak**'ı seçip terminalde cevap ver
  ya da isteği reddet.
- **Onay reddedildi: fiziksel tıklama değil.** Uzak masaüstü araçları ve `xdotool` XTEST
  tıklamaları gönderir; koruma bunları reddeder. Gerçek fareyi kullan ya da **Ayarlar → Güvenlik →
  Fiziksel tıklama koruması**'nı kapat (yalnızca DÜŞÜK ve ORTA için). Fare düğmelerini yer
  değiştirdiysen (solak kullanım, `xmodmap` ya da `xinput` ile) koruma birincil tıklama işini gören
  düğmeyi izler.
- **Kayıt dosyası** `~/.local/share/nobi/nobi.log`.
