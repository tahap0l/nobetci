# Nöbetçi Privacy Policy

**Last updated: November 21, 2026**

Nöbetçi is a desktop application that helps you review AI coding-agent permission requests and
prepare messages for AI agents. It runs on your computer and does not require an account.

## Information and local storage

Nöbetçi does not send telemetry, analytics, crash reports, or update checks. Settings, request
history, and logs are stored locally on your computer. Prompt drafts and rewritten messages are not
saved to history. Before request text is written to history or shown in a notification, Nöbetçi
masks recognized secrets such as API tokens, passwords, and private keys. The approval card shows
the request in full so you can review what you are approving.

## Optional AI message review

Prompt Studio sends a draft only after you choose a provider and select **Improve**:

- **Ollama:** The draft is sent to the Ollama service on your computer. If you choose an Ollama
  model marked as cloud, that provider may forward the draft outside your computer.
- **OpenAI:** If you select OpenAI and choose **Improve**, the current draft is sent to the OpenAI
  API. The optional API key is kept in your operating system's credential store. Nöbetçi does not
  save the draft to its history or forward the result to an AI agent. OpenAI handles API requests
  under its own terms and data policies.

The rewritten message is shown for your review. You decide whether to copy it to another app.

## Optional island widgets

Weather is off by default. If you select a city, Open-Meteo receives that city's coordinates and your
connection's IP address. Device location and agent data are not sent. The media card reads track details
from the operating system on your device without sending or storing them. The system card reads
processor, memory and graphics load on your device, only while it is on screen. Agenda notes stay in an
`agenda.json` file on your computer.

## The island assistant

When you send a message to an AI app from the assistant, Nöbetçi sends nothing to that service
itself: it opens the app or your browser and copies the message to the clipboard. Where the message
goes from there depends on what you picked:

- **ChatGPT, Claude, Perplexity, Copilot or Grok on the web:** the message travels inside the page's
  address. It reaches that service as soon as your browser opens the page, and it is written to your
  browser history. Some of these services may start answering it right away.
- **Desktop apps, and Gemini, DeepSeek and Mistral:** the message goes into the app's text box, or
  you paste it from the clipboard; sending is up to you.

**Ask here** sends the message to the provider you chose in Prompt Studio (Ollama or OpenAI). Voice
input (Windows and macOS) is your operating system's own dictation; Nöbetçi records no audio.

## Installer and code signing

The installer does not collect or send information. Windows releases are not code-signed yet; once
signing through SignPath is switched on, it happens when a release is built and involves no data from
your computer (see the [code signing policy](CODE_SIGNING_POLICY.md)).

## Your choices

You can use Nöbetçi without Prompt Studio, choose local Ollama, or choose OpenAI with your own API
key. You can remove the saved OpenAI key in Prompt Studio. You control the local history and settings
from the app.

## This website

The website (<https://tahap0l.github.io/nobetci/>) is published on GitHub Pages: GitHub serves the
pages and keeps its own record of visits (IP addresses included) under GitHub's privacy statement.
The site has no cookies, analytics or ads. It remembers the language and mascot you pick in your
browser only. The live demo runs entirely in your browser and sends nothing anywhere.

## Changes and contact

This policy may be updated when Nöbetçi's data practices change. For questions or privacy requests,
open an issue at <https://github.com/tahap0l/nobetci/issues>.

---

# Nöbetçi Gizlilik Politikası

**Son güncelleme: 21 Kasım 2026**

Nöbetçi, yapay zekâ kodlama ajanlarının izin isteklerini incelemene ve ajanlara göndereceğin
mesajları hazırlamana yardımcı olan bir masaüstü uygulamasıdır. Bilgisayarında çalışır ve hesap
açmanı gerektirmez.

## Bilgiler ve yerel kayıtlar

Nöbetçi telemetri, analiz, çökme raporu veya güncelleme kontrolü göndermez. Ayarlar, istek geçmişi
ve kayıtlar bilgisayarında tutulur. Mesaj taslakları ve düzeltilmiş metinler geçmişe kaydedilmez.
İstek geçmişe yazılmadan veya bildirimde gösterilmeden önce API anahtarı, parola ve özel anahtar gibi
tanınan sırlar maskelenir. Onay kartı, neye izin verdiğini inceleyebilmen için isteği eksiksiz
gösterir.

## İsteğe bağlı yapay zekâ ile mesaj inceleme

Mesaj Atölyesi taslağı yalnızca bir sağlayıcı seçip **Mesajı iyileştir** dediğinde gönderir:

- **Ollama:** Taslak, bilgisayarındaki Ollama servisine gönderilir. **Cloud** olarak işaretlenmiş bir
  Ollama modeli seçersen sağlayıcı taslağı bilgisayarının dışına iletebilir.
- **OpenAI:** OpenAI'yi seçip **Mesajı iyileştir** dediğinde o anki taslak OpenAI API'sine gönderilir.
  İsteğe bağlı API anahtarı işletim sisteminin parola kasasında tutulur. Nöbetçi taslağı geçmişine
  kaydetmez ve sonucu bir yapay zekâ ajanına iletmez. API isteklerinin işlenmesi OpenAI'nin kendi
  koşullarına ve veri politikalarına tabidir.

Düzenlenmiş mesajı önce sen incelersin. Başka bir uygulamaya kopyalamaya sen karar verirsin.

## İsteğe bağlı ada bileşenleri

Hava durumu varsayılan olarak kapalıdır. Bir şehir seçersen Open-Meteo o şehrin koordinatlarını ve
bağlantının IP adresini alır. Cihaz konumu veya ajan verisi gönderilmez. Medya kartı parça bilgilerini
işletim sisteminden cihazda okur; göndermez ve saklamaz. Sistem kartı işlemci, bellek ve ekran kartı
kullanımını yalnızca kart ekrandayken cihazda okur. Ajanda notların bilgisayarındaki `agenda.json`
dosyasında kalır.

## Ada asistanı

Asistanda bir yapay zekâ uygulaması seçip gönderdiğinde Nöbetçi o servise kendisi bir şey göndermez:
uygulamayı ya da tarayıcını açar ve mesajı panoya kopyalar. Mesajın oradan nereye gittiği seçtiğin
yere bağlıdır:

- **Web'de ChatGPT, Claude, Perplexity, Copilot ya da Grok:** Mesaj sayfanın adresinin içinde gider.
  Tarayıcın sayfayı açtığı anda mesaj o servise ulaşır ve tarayıcı geçmişine de yazılır. Bu
  servislerin bazıları mesajı hemen cevaplamaya başlayabilir.
- **Masaüstü uygulamaları ile Gemini, DeepSeek ve Mistral:** Mesaj uygulamanın yazı kutusuna gelir ya
  da panodan sen yapıştırırsın; göndermeye sen karar verirsin.

**Burada sor** seçeneği mesajı Mesaj Atölyesi'nde seçtiğin sağlayıcıya (Ollama ya da OpenAI)
gönderir. Sesle yazma (Windows ve macOS) işletim sisteminin kendi dikte özelliğidir; Nöbetçi ses
kaydetmez.

## Kurulum dosyası ve kod imzalama

Kurulum dosyası bilgi toplamaz ve göndermez. Windows sürümleri henüz kod imzalı değil; SignPath
üzerinden imzalama açıldığında bu iş sürüm derlenirken yapılır ve bilgisayarından hiçbir veri içermez
(bkz. [kod imzalama politikası](CODE_SIGNING_POLICY.md)).

## Seçimlerin

Nöbetçi'yi Mesaj Atölyesi olmadan kullanabilir, yerel Ollama'yı seçebilir veya kendi API anahtarınla
OpenAI'yi seçebilirsin. Kayıtlı OpenAI anahtarını Mesaj Atölyesi'nden silebilirsin. Yerel geçmişini
ve ayarlarını uygulama içinden yönetirsin.

## Bu web sitesi

Web sitesi (<https://tahap0l.github.io/nobetci/>) GitHub Pages'te yayınlanır: sayfaları GitHub sunar
ve ziyaretlerin kaydını (IP adresi dahil) GitHub'ın gizlilik bildirimine göre tutar. Sitede çerez,
analiz ya da reklam yok. Seçtiğin dili ve maskotu yalnızca tarayıcında hatırlar. Canlı demo tamamen
tarayıcında çalışır ve hiçbir yere bir şey göndermez.

## Değişiklikler ve iletişim

Nöbetçi'nin veri uygulamaları değişirse bu politika güncellenebilir. Soru veya gizlilik talebi için
<https://github.com/tahap0l/nobetci/issues> adresinden issue açabilirsin.
