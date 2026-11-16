# Code signing policy

[Türkçe](#kod-imzalama-politikası)

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

> **Status:** Nöbetçi has applied for SignPath Foundation's open-source code signing. Releases up to
> and including v2.3.1 are not code-signed. Once the application is accepted, every Windows release
> is signed as described below, and this note is updated with the first signed version.

## What is signed

On Windows, each release signs three files:

| File | What it is |
|---|---|
| `nobetci.exe` | The app |
| `nobetci-hook.exe` | The relay Claude Code starts for each hook event |
| `Nobetci-<version>-setup.exe` | The installer that carries both |

Every signed file carries the product name **Nobetci** and the version being released, and SignPath
refuses a file that doesn't. Only files built from this repository's source are signed under this
policy. The installer also contains unmodified, unsigned NSIS plug-ins (part of the installer
toolkit); they are not signed under this certificate. The WebView2 runtime is not shipped at all:
when it is missing, the installer downloads Microsoft's own signed setup.

macOS builds are signed with Apple's Developer ID and notarized by Apple once the project is enrolled
in the Apple Developer Program; that signature does not come from SignPath. Linux packages are not
signed; check them against the release's `SHA256SUMS.txt`.

## How a release is signed

1. A release is started by hand from the `main` branch with the
   [Release workflow](.github/workflows/release.yml), which runs only on GitHub-hosted runners.
2. The workflow checks that the tag matches the version in `package.json`, `tauri.conf.json` and
   `Cargo.toml`, runs the tests, and builds the app and the relay from that commit.
3. The two programs go to SignPath as a signing request. An approver checks on SignPath that the
   request comes from the Release workflow, on `main`, at the commit being released, and only then
   approves it.
4. The installer is built from the signed programs and goes to SignPath as a second request, which
   is approved the same way.
5. The signed installer is checked (`Get-AuthenticodeSignature`), its SHA-256 is written to
   `SHA256SUMS.txt`, and the release is published on GitHub.

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

Nöbetçi installs for the current user only. It adds its hooks to `~/.claude/settings.json` only after
showing you the exact change and a dated backup, and only when you click to apply it. The uninstaller
takes those entries out again (after another backup) and removes the app and the relay.

## Checking a signature

On Windows, right-click the file → **Properties → Digital Signatures**, or run:

```powershell
Get-AuthenticodeSignature .\Nobetci-<version>-setup.exe | Format-List Status, SignerCertificate
```

If you find a file signed under this policy that was not built from this repository, or anything
else that looks wrong, report it privately as described in [SECURITY.md](SECURITY.md).

---

# Kod imzalama politikası

Ücretsiz kod imzalama [SignPath.io](https://signpath.io) tarafından, sertifika
[SignPath Foundation](https://signpath.org) tarafından sağlanmaktadır.
(Free code signing provided by SignPath.io, certificate by SignPath Foundation.)

> **Durum:** Nöbetçi, SignPath Foundation'ın açık kaynak kod imzalama programına başvurdu. v2.3.1 ve
> önceki sürümler kod imzalı değil. Başvuru kabul edilince her Windows sürümü aşağıda anlatıldığı gibi
> imzalanır; bu not ilk imzalı sürümle güncellenir.

## Neler imzalanır

Windows'ta her sürümde üç dosya imzalanır:

| Dosya | Ne olduğu |
|---|---|
| `nobetci.exe` | Uygulama |
| `nobetci-hook.exe` | Claude Code'un her kanca olayında çalıştırdığı aktarıcı |
| `Nobetci-<sürüm>-setup.exe` | İkisini taşıyan kurulum dosyası |

İmzalanan her dosyada ürün adı **Nobetci** ve yayımlanan sürüm yazar; yazmayan dosyayı SignPath
reddeder. Bu politika kapsamında yalnızca bu deponun kaynak kodundan derlenen dosyalar imzalanır.
Kurulum dosyasında, kurulum aracının parçası olan değiştirilmemiş ve imzasız NSIS eklentileri de
bulunur; bunlar bu sertifikayla imzalanmaz. WebView2 çalışma ortamı pakete konmaz: eksikse kurulum
dosyası Microsoft'un kendi imzalı kurulumunu indirir.

macOS sürümleri, proje Apple Developer Program'a katıldığında Apple'ın Developer ID'siyle imzalanır
ve Apple onayından (notarization) geçer; bu imza SignPath'ten gelmez. Linux paketleri imzalanmaz;
sürümdeki `SHA256SUMS.txt` ile doğrulanır.

## Bir sürüm nasıl imzalanır

1. Sürüm, `main` dalından [Release iş akışıyla](.github/workflows/release.yml) elle başlatılır; iş akışı
   yalnızca GitHub'ın kendi sunucularında çalışır.
2. İş akışı etiketin `package.json`, `tauri.conf.json` ve `Cargo.toml` sürümüyle aynı olduğunu
   denetler, testleri çalıştırır, uygulamayı ve aktarıcıyı o commit'ten derler.
3. İki program SignPath'e imzalama isteği olarak gider. Onaylayıcı, isteğin Release iş akışından,
   `main` dalından ve yayımlanan commit'ten geldiğini SignPath'te denetler; ancak ondan sonra onaylar.
4. Kurulum dosyası imzalı programlardan oluşturulur ve ikinci istek olarak SignPath'e gider; aynı
   şekilde onaylanır.
5. İmzalı kurulum dosyası denetlenir (`Get-AuthenticodeSignature`), SHA-256 değeri
   `SHA256SUMS.txt` dosyasına yazılır ve sürüm GitHub'da yayımlanır.

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

Nöbetçi yalnızca o anki kullanıcı için kurulur. Kancalarını `~/.claude/settings.json` dosyasına ancak
değişikliğin tamamını ve tarihli bir yedeği gösterdikten sonra, sen uygula dediğinde ekler. Kaldırma
aracı bu girdileri (yine yedek alarak) geri çıkarır, uygulamayı ve aktarıcıyı siler.

## İmzayı kontrol etmek

Windows'ta dosyaya sağ tıkla → **Özellikler → Dijital İmzalar**, ya da şunu çalıştır:

```powershell
Get-AuthenticodeSignature .\Nobetci-<sürüm>-setup.exe | Format-List Status, SignerCertificate
```

Bu politikayla imzalanmış ama bu depodan derlenmemiş bir dosya ya da başka bir tuhaflık görürsen
[SECURITY.md](SECURITY.md)'de anlatıldığı gibi gizli olarak bildir.
