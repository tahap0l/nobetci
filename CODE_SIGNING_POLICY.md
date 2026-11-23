# Code signing policy

[Türkçe](#kod-imzalama-politikası)

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

> **Status:** Nöbetçi has applied for SignPath Foundation's open-source code signing. No release
> has been code-signed so far, v2.4.1 included, which is why SmartScreen may warn about the
> installer. Once the application is accepted and signing is switched on, every Windows release is
> signed as described below, and this note is updated with the first signed version. Until then,
> check every download against the release's `SHA256SUMS.txt` (see
> [Checking a signature](#checking-a-signature)). The notes of each release say whether its files
> are signed.

## What is signed

On Windows, each release signs three files:

| File | What it is |
|---|---|
| `nobetci.exe` | The app |
| `nobetci-hook.exe` | The relay Claude Code starts for each hook event |
| `Nobetci-<version>-setup.exe` | The installer that carries both (also published as `Nobetci-setup.exe`, the same file) |

Every signed file carries the product name **Nobetci** and the version being released, and SignPath
refuses a file that doesn't. Only files built from this repository's source are signed under this
policy.

The installer carries the two signed programs byte for byte: it is built with
`tauri bundle --no-binary-patching`, and the workflow checks by hash that bundling left the programs
exactly as they came back from signing, before the installer goes to SignPath itself. Some files
are not signed under this certificate:

- the unmodified NSIS plug-ins inside the installer (part of the installer toolkit);
- `uninstall.exe`, which the installer writes on your machine at install time;
- the WebView2 runtime, which is not shipped at all: when it is missing, the installer downloads
  Microsoft's own signed setup.

macOS builds are signed with Apple's Developer ID and notarized by Apple once the project is
enrolled in the Apple Developer Program; that signature does not come from SignPath. Until then the
app is only ad-hoc signed. Linux packages are not signed; check them against the release's
`SHA256SUMS.txt`.

## How a release is signed

1. A release is started by hand from the `main` branch: **Actions → Release → Run workflow**, with
   the tag to create (`vX.Y.Z`). This is the only way to start one. The
   [Release workflow](.github/workflows/release.yml) runs only on GitHub-hosted runners; a run from
   any other branch builds and tests everything but publishes nothing.
2. The workflow checks that the tag matches the version in `package.json`, `tauri.conf.json` and
   `Cargo.toml`, runs the tests, and builds the app and the relay from that commit. These build
   jobs run third-party code (npm and cargo dependencies), so they get a read-only token and no
   signing secrets.
3. The two programs go to SignPath as a signing request from a job of their own, which runs
   nothing from the repository, npm or cargo: a runner keeps a job's secrets for the whole job, so
   the API token never shares a job with third-party code. An approver checks on SignPath that the
   request comes from the Release workflow, on `main`, at the commit being released, and only then
   approves it.
4. The installer is built from the signed programs (unchanged, as above) in the next job, which
   gets no signing secret, and goes to SignPath as a second request, from another fresh machine
   that runs nothing from the repository, npm or cargo. It is approved the same way.
5. The signed installer is checked (`Get-AuthenticodeSignature`), its SHA-256 is written to
   `SHA256SUMS.txt`, and the release is published on GitHub. If the tag already exists on another
   commit, the workflow refuses to publish unless it was started with **replace**, which moves the
   tag to the commit just built and replaces the release's files and notes.

On macOS, Developer ID signing and notarization run in a separate job on a fresh machine where only
Apple's own tools (`codesign`, `notarytool`, `stapler`) touch the files: nothing from the
repository, npm or cargo runs while the Apple secrets are in reach.

The SignPath settings the workflow expects are in [`.signpath/`](.signpath/).

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [tahap0l](https://github.com/tahap0l) ([all contributors](https://github.com/tahap0l/nobetci/graphs/contributors)) |
| Approvers | [tahap0l](https://github.com/tahap0l) |

- **Committers** may change the source code directly.
- **Reviewers** review every change from anyone who is not a committer. Outside contributions come
  in as pull requests and are merged only after review and passing CI.
- **Approvers** decide, for each signing request, whether the build can be signed.

Every team member uses multi-factor authentication for GitHub and for SignPath.

## Privacy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

The features that reach the network are all off until you turn them on: Prompt Studio's Ollama or
OpenAI review, the island assistant's **Ask here**, and the weather card (Open-Meteo, once you pick a
city). Opening an AI app or website from the assistant hands your message to that app or your
browser; Nöbetçi does not send it. Details are in the [privacy policy](PRIVACY.md).

## Changes to your system

Nöbetçi installs for the current user only. It adds its hooks to `~/.claude/settings.json` — and, if
you connect them, to Codex's and Cursor's hook files — only after showing you the exact change and a
dated backup, and only when you click to apply it. The Windows uninstaller takes those entries out
again, each file after another backup, and removes the app, the relay and, if you registered it,
the ChatGPT Web bridge's browser registration. On macOS and Linux the
[installation guide](docs/install.md) shows how to do the same.

## Checking a signature

On Windows, right-click the file → **Properties → Digital Signatures**, or run:

```powershell
Get-AuthenticodeSignature .\Nobetci-<version>-setup.exe | Format-List Status, SignerCertificate
```

An unsigned release shows `NotSigned`. Check it against the release's `SHA256SUMS.txt` instead: the
value from `Get-FileHash .\Nobetci-<version>-setup.exe -Algorithm SHA256` must be the one listed
there.

If you find a file signed under this policy that was not built from this repository, or anything
else that looks wrong, report it privately as described in [SECURITY.md](SECURITY.md).

---

# Kod imzalama politikası

Ücretsiz kod imzalama [SignPath.io](https://signpath.io) tarafından, sertifika
[SignPath Foundation](https://signpath.org) tarafından sağlanmaktadır.
(Free code signing provided by SignPath.io, certificate by SignPath Foundation.)

> **Durum:** Nöbetçi, SignPath Foundation'ın açık kaynak kod imzalama programına başvurdu.
> Şimdiye kadarki sürümlerin hiçbiri (v2.4.1 dahil) kod imzalı değil; Windows'ta SmartScreen bu
> yüzden uyarı gösterebilir. Başvuru kabul edilip imzalama açılınca her Windows sürümü aşağıda
> anlatıldığı gibi imzalanır; bu not ilk imzalı sürümle güncellenir. O zamana kadar her indirdiğin
> dosyayı sürümdeki `SHA256SUMS.txt` ile doğrula (aşağıdaki "İmzayı kontrol etmek" bölümü nasıl
> yapılacağını anlatır). Her sürümün notları, o sürümün dosyalarının imzalı olup olmadığını söyler.

## Neler imzalanır

Windows'ta her sürümde üç dosya imzalanır:

| Dosya | Ne olduğu |
|---|---|
| `nobetci.exe` | Uygulama |
| `nobetci-hook.exe` | Claude Code'un her kanca olayında çalıştırdığı aktarıcı |
| `Nobetci-<sürüm>-setup.exe` | İkisini taşıyan kurulum dosyası (aynı dosya `Nobetci-setup.exe` adıyla da yayımlanır) |

İmzalanan her dosyada ürün adı **Nobetci** ve yayımlanan sürüm yazar; yazmayan dosyayı SignPath
reddeder. Bu politika kapsamında yalnızca bu deponun kaynak kodundan derlenen dosyalar imzalanır.

Kurulum dosyası iki imzalı programı bayt bayt aynen taşır: `tauri bundle --no-binary-patching` ile
oluşturulur ve iş akışı, kurulum dosyası SignPath'e gitmeden önce paketlemenin programları imzadan
döndükleri hâliyle bıraktığını hash değerleriyle denetler. Şu dosyalar bu sertifikayla imzalanmaz:

- kurulum dosyasındaki, kurulum aracının parçası olan değiştirilmemiş NSIS eklentileri;
- kurulum sırasında kurulum dosyasının senin bilgisayarına yazdığı `uninstall.exe`;
- WebView2 çalışma ortamı; pakete hiç konmaz: eksikse kurulum dosyası Microsoft'un kendi imzalı
  kurulumunu indirir.

macOS sürümleri, proje Apple Developer Program'a katıldığında Apple'ın Developer ID'siyle imzalanır
ve Apple onayından (notarization) geçer; bu imza SignPath'ten gelmez. O zamana kadar uygulama
yalnızca ad-hoc imzalıdır. Linux paketleri imzalanmaz; sürümdeki `SHA256SUMS.txt` ile doğrulanır.

## Bir sürüm nasıl imzalanır

1. Sürüm `main` dalından elle başlatılır: **Actions → Release → Run workflow**, oluşturulacak
   etiketle (`vX.Y.Z`). Bir sürüm başlatmanın tek yolu budur.
   [Release iş akışı](.github/workflows/release.yml) yalnızca GitHub'ın kendi sunucularında çalışır;
   başka bir daldan başlatılan çalışma her şeyi derleyip test eder ama hiçbir şey yayımlamaz.
2. İş akışı etiketin `package.json`, `tauri.conf.json` ve `Cargo.toml` sürümüyle aynı olduğunu
   denetler, testleri çalıştırır, uygulamayı ve aktarıcıyı o commit'ten derler. Bu derleme işleri
   üçüncü taraf kodu (npm ve cargo bağımlılıkları) çalıştırdığı için yalnızca okuma yetkili bir
   jeton alır, imzalama sırlarına erişemez.
3. İki program, depodan, npm'den ya da cargo'dan hiçbir şey çalıştırmayan kendi işlerinden
   SignPath'e imzalama isteği olarak gider: GitHub'ın makinesi bir işin sırlarını iş boyunca
   tuttuğundan API jetonu hiçbir zaman üçüncü taraf koduyla aynı işte bulunmaz. Onaylayıcı, isteğin
   Release iş akışından, `main` dalından ve yayımlanan commit'ten geldiğini SignPath'te denetler;
   ancak ondan sonra onaylar.
4. Kurulum dosyası imzalı programlardan (yukarıda anlatıldığı gibi değiştirilmeden), hiçbir
   imzalama sırrı almayan bir sonraki işte oluşturulur ve depodan, npm'den ya da cargo'dan hiçbir
   şey çalıştırmayan başka bir temiz makineden ikinci istek olarak SignPath'e gider; aynı şekilde
   onaylanır.
5. İmzalı kurulum dosyası denetlenir (`Get-AuthenticodeSignature`), SHA-256 değeri
   `SHA256SUMS.txt` dosyasına yazılır ve sürüm GitHub'da yayımlanır. Etiket zaten başka bir
   commit'i gösteriyorsa iş akışı, **replace** ile başlatılmadıkça yayımlamayı reddeder; **replace**
   etiketi az önce derlenen commit'e taşır, sürümün dosyalarını ve notlarını değiştirir.

macOS'ta Developer ID imzası ve Apple onayı, yalnızca Apple'ın kendi araçlarının (`codesign`,
`notarytool`, `stapler`) dosyalara dokunduğu temiz bir makinede, ayrı bir işte yapılır: Apple sırları
erişilebilirken depodan, npm'den ya da cargo'dan hiçbir şey çalışmaz.

İş akışının beklediği SignPath ayarları [`.signpath/`](.signpath/) klasöründedir.

## Ekip rolleri

| Rol | Üyeler |
|---|---|
| Kod yazanlar ve gözden geçirenler | [tahap0l](https://github.com/tahap0l) ([katkıda bulunanlar](https://github.com/tahap0l/nobetci/graphs/contributors)) |
| Onaylayıcılar | [tahap0l](https://github.com/tahap0l) |

- **Kod yazanlar** kaynak kodu doğrudan değiştirebilir.
- **Gözden geçirenler**, ekip dışından gelen her değişikliği inceler. Dış katkılar pull request olarak
  gelir; yalnızca incelenip CI'dan geçtikten sonra birleştirilir.
- **Onaylayıcılar** her imzalama isteği için derlemenin imzalanıp imzalanamayacağına karar verir.

Ekipteki herkes GitHub'da ve SignPath'te çok adımlı doğrulama (MFA) kullanır.

## Gizlilik

Bu program, kullanıcı ya da programı kuran veya kullanan kişi özellikle istemedikçe başka ağ
sistemlerine hiçbir bilgi aktarmaz.

Ağa çıkan özelliklerin hepsi sen açana kadar kapalıdır: Mesaj Atölyesi'nin Ollama veya OpenAI
incelemesi, ada asistanının **Burada sor** seçeneği ve hava durumu kartı (şehir seçince Open-Meteo).
Asistandan bir yapay zekâ uygulaması ya da sitesi açıldığında mesajın o uygulamaya ya da tarayıcına
verilir; Nöbetçi göndermez. Ayrıntılar [gizlilik politikasında](PRIVACY.md).

## Sistemindeki değişiklikler

Nöbetçi yalnızca o anki kullanıcı için kurulur. Kancalarını `~/.claude/settings.json` dosyasına —
bağlarsan Codex'in ve Cursor'un kanca dosyalarına da — ancak değişikliğin tamamını ve tarihli bir
yedeği gösterdikten sonra, sen uygula dediğinde ekler. Windows'taki kaldırma aracı bu girdileri her
dosyanın yedeğini alarak geri çıkarır; uygulamayı, aktarıcıyı ve kaydettiysen ChatGPT Web
köprüsünün tarayıcı kaydını siler. macOS ve Linux'ta aynısını nasıl yapacağını
[kurulum kılavuzu](docs/kurulum.md) anlatır.

## İmzayı kontrol etmek

Windows'ta dosyaya sağ tıkla → **Özellikler → Dijital İmzalar**, ya da şunu çalıştır:

```powershell
Get-AuthenticodeSignature .\Nobetci-<sürüm>-setup.exe | Format-List Status, SignerCertificate
```

İmzasız bir sürümde durum `NotSigned` görünür. O zaman dosyayı sürümdeki `SHA256SUMS.txt` ile
doğrula: `Get-FileHash .\Nobetci-<sürüm>-setup.exe -Algorithm SHA256` komutunun verdiği değer orada
yazanla aynı olmalı.

Bu politikayla imzalanmış ama bu depodan derlenmemiş bir dosya ya da başka bir tuhaflık görürsen
[SECURITY.md](SECURITY.md)'de anlatıldığı gibi gizli olarak bildir.
