# ChatGPT Web bağlantısı

Nöbetçi, Chrome veya Edge’de chatgpt.com yanıt üretirken adada **ChatGPT Web** oturumunu gösterir.
Yanıt üretimi bittiğinde durum güncellenir. Eklenti mesaj metnini, başlığı, sohbet adresini ve çerezleri
aktarmaz. Yalnızca rastgele bir oturum kimliği ile çalışma durumunu yerel uygulamaya gönderir.

## Windows üzerinde deneme

1. Bu değişikliği içeren bir Nöbetçi derlemesini kur ve uygulamayı aç. 2.1.1’in mevcut paketi bu köprüyü içermez.
2. Chrome’da `chrome://extensions`, Edge’de `edge://extensions` sayfasını aç. Geliştirici modunu aç ve
   **Paketlenmemiş öğe yükle** ile buradaki `extension` klasörünü seç.
3. Eklenti kimliğini kopyala. Bu dizinde PowerShell’de aşağıdaki komutu çalıştır. Edge için `-Browser Edge` kullan.

   ```powershell
   .\register-windows.ps1 -ExtensionId BURAYA_EKLENTI_KIMLIGI -Browser Chrome
   ```

4. ChatGPT sekmesini yenile ve yeni bir yanıt başlat. Adada önce çalışan, ardından biten bir oturum görünür.
   Sekmeyi kapattığında oturum kaldırılır.

Bu bağlantı ChatGPT’nin web arayüzündeki yanıtı durdurma düğmesini gözler. ChatGPT bu düğmeyi değiştirirse
algılama güncelleme gerektirebilir. ChatGPT web oturumları için komut onayı sunulmaz.
