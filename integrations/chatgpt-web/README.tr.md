# ChatGPT Web köprüsü

[English](README.md) · **Türkçe**

chatgpt.com Chrome'da ya da Edge'de yanıt yazarken Nöbetçi adada bir **ChatGPT Web** oturumu
gösterir. Yanıt bitince oturum bunu belirtir; sekmeyi kapattığında oturum kalkar.

**Yalnız Windows.** Köprüyü tarayıcıya yalnız bu klasördeki Windows betiği kaydeder. macOS ve
Linux'ta kayıt yok, bu yüzden orada eklentinin konuşacağı bir şey olmaz.

## Ne gönderir?

Eklenti tek bir şeye bakar: ChatGPT'nin durdurma düğmesi sayfada mı? Nöbetçi'ye rastgele bir
oturum kimliği ve üç durumdan birini gönderir: çalışıyor, bitti ya da kapandı. Sohbeti, başlığını,
adresini ya da çerezlerini asla göndermez.

ChatGPT Web için onay yoktur. Tarayıcıdaki ChatGPT bilgisayarında hiçbir şey çalıştırmaz, bu
yüzden onaylanacak bir şey de olmaz.

## Kurulum

1. Nöbetçi'nin son sürümünü kur ve bir kez aç: aktarıcısını `%LOCALAPPDATA%\Nobetci\bin`
   klasörüne koyar. Nöbetçi 2.1.4 ile 2.4.1 arası köprünün mesajlarını düşürür; bu sürümlerle
   adada hiçbir şey görünmez. Nöbetçi 2.5.0 bunu düzeltiyor.
2. Chrome'da `chrome://extensions`, Edge'de `edge://extensions` sayfasını aç. **Geliştirici
   modu**nu aç, **Paketlenmemiş öğe yükle**'yi seç ve buradaki `extension` klasörünü göster.
3. Eklentinin kimliğini kopyala (a ile p arasındaki harflerden 32 karakter). Bu klasörde
   PowerShell'i aç ve aşağıdaki komutu çalıştır. Edge için `-Browser Edge` yaz.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\register-windows.ps1 -ExtensionId EKLENTI_KIMLIGI -Browser Chrome
   ```

   `-ExecutionPolicy Bypass` yalnız bu çalıştırma için geçerlidir, sistemin ilkesini değiştirmez.
   Bu olmadan Windows betiği çalıştırmaz: imzasız betikler ve indirilen ZIP'ten çıkan dosyalar
   varsayılan olarak engellenir.
4. ChatGPT sekmesini yenile ve bir yanıt başlat. Adada önce çalışan, sonra biten bir oturum
   görünür.

Betik `%LOCALAPPDATA%\Nobetci\chatgpt-native-host-Chrome.json` (ya da `-Edge.json`) dosyasını
yazar ve
`HKCU\Software\Google\Chrome\NativeMessagingHosts\io.github.tahap0l.nobetci.chatgpt` kayıt
anahtarını (Edge için `Microsoft\Edge` altındaki aynı anahtarı) bu dosyaya yönlendirir. Başka
hiçbir şeyi değiştirmez ve yönetici yetkisi istemez. Mesajları Windows'un görüntüleme dilini izler.

## Kaldırma

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister-windows.ps1
```

Bu komut kaydı iki tarayıcı için de kaldırır; yalnız birini kaldırmak için `-Browser Chrome` ya da
`-Browser Edge` ekle. Ardından eklentiyi `chrome://extensions` ya da `edge://extensions`
sayfasından kaldır.

Nöbetçi'yi kaldırmak da kaydı iki tarayıcı için siler; sana yalnızca eklentiyi kaldırmak kalır.
Güncelleme kaydı korur. 2.4.1 ve önceki sürümlerin kaldırıcıları ise kaydı geride bırakır ve
tarayıcı artık orada olmayan bir aktarıcıyı gösterir: bunlardan birini kaldıracaksan önce
yukarıdaki komutu çalıştır.

## Adada bir şey görünmüyorsa

- **Nöbetçi açık mı?** Nöbetçi kapalıyken eklenti denemeler arasında giderek daha uzun bekler:
  önce 5 saniye, sonra her seferinde iki katı, en çok bir dakika. Nöbetçi'yi yeniden açınca ada en
  geç bir dakika içinde durumu yakalar.
- **Doğru tarayıcı, doğru kimlik mi?** Kayıt betiğini `chrome://extensions` sayfasının şu an
  gösterdiği kimlikle yeniden çalıştır. Paketlenmemiş bir eklentinin klasörü taşınınca kimliği
  değişir.
- **ChatGPT değişti mi?** Köprü ChatGPT'nin durdurma düğmesine bakar
  (`button[data-testid="stop-button"]`). ChatGPT bu düğmeyi değiştirirse köprünün güncellenmesi
  gerekir.
