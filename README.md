# Media Collector v0.5.4

Web sayfalarında görsel/video seçme ve dosyaları düzenli klasörlere kaydetme üzerine geliştirilen Chrome MV3 prototipi.

**Geliştirme sürümü — Chrome Web Store yayını değildir.**

[Chrome ZIP](https://github.com/iwantthesky/media-collector/releases/download/v0.5.4/Media-Collector-v0.5.4-chrome.zip) · [Kaynak ZIP](https://github.com/iwantthesky/media-collector/releases/download/v0.5.4/Media-Collector-v0.5.4-source.zip)

## Kurulum

Chrome ZIP dosyasını kalıcı bir klasöre çıkar. Chrome'da chrome://extensions sayfasını aç. Geliştirici modunda Paketlenmemiş öğe yükle ile `manifest.json` içeren klasörü seç. Mevcut kurulum güncelleniyorsa Yeniden yükle düğmesine bas ve açık medya sayfalarını yenile. Yerel yardımcı kurulumu gerekmez.

## Kullanım

- **Sayfadan tıklayarak seç:** Yanındaki video biçimini belirle, görsel ve videoları seç, sayfadaki Seçilenleri indir düğmesine bas. Esc seçimden çıkar.
- **Video biçimi:** Otomatik mod doğrudan MP4 adayını önce dener, sonra diğer doğrudan biçimlere geçer; adres bulunamazsa güvenli WebM kaydı yapar. MP4 seçeneği gerçek bir doğrudan MP4 kaynağını tercih eder; bulunamazsa seçimi hata ile bırakmak yerine güvenli WebM kaydına düşer ve bunu sonuç çubuğunda bildirir.
- **Tarama:** Hızlı tara, Videoları tara veya Kaydır + tara ile sayfadaki öğeleri bul.
- **Doğrudan adres:** Medya dosyası adresi gir. Normal web sayfası adresleri dosya bağlantısı değildir.
- **Yakalama:** Başlattığın sekmede HLS ve DASH listeleri, sunucu türünü belirttiğinde uzantısız adreslerde de tanınır. DASH listeleri panelde indirme desteği olmadan gösterilir.
- **İndirme hızı:** Düşük, Dengeli ve Yüksek kademeleri sırasıyla 1, 3 ve 6 eşzamanlı indirmeye izin verir. Aynı ayar toplu dosyalara ve HLS parçalarına uygulanır. Varsayılan Dengeli'dir. Kademe tek dosyanın bant genişliğini sınırlamaz.
- **Sunucu sınırları:** Hızlı toplu indirme erişim kısıtına veya hesap engeline yol açabilir. HLS, `401` veya `403` alınca işlemi durdurur. `429` yanıtında sunucunun bildirdiği `Retry-After` süresine uyar. Otomatik bekleme sınırını aşan sürelerde indirme durur ve istenen süre gösterilir.
- **Gizlilik:** Geçici adresleri ve önceki sürümlerden kalan URL alanlarını temizle. Bu işlem indirilmiş dosyaları veya Chrome indirme geçmişini silmez.

Siteye özel arayüz bölümleri, pano listesi modu ve YouTube yerel indirme yardımcısı bu sürümden çıkarılmıştır. YouTube sayfalarında tarama/seçim desteklenmez; sayfa ve CDN parça adresleri doğrudan dosya olarak indirilmez. Genel medyayı tanıyan mevcut sayfa içi tarama kodu korunur.

## Sınırlar

Her sitede çalışması garanti edilmez. Doğrudan adres bulunamadığında seçilen oynatıcı akışı MediaRecorder ile gerçek zamanda WebM olarak yeniden kodlanabilir; yalnızca uzantı değiştirilmez. Chrome'un gerçek zamanlı MP4/H.264 kaydı bu ortamda bozuk kare ürettiği için devre dışıdır; gerçek doğrudan MP4 dosyaları normal indirilmeye devam eder. Kullanılabilir ses desteği Chrome/işletim sistemi yeteneklerine ve sayfanın izinlerine bağlıdır. Ayrı sesli HLS ve DASH birleştirme tamamlanmış değildir. DRM aşma desteği yoktur. Yalnızca gerekli kullanım haklarına ve izinlere sahip olduğun içeriklerde kullan.

Arayüz adlarını kaldırmak hukuki uygunluk veya mağaza onayı sağlamaz. Ürün henüz Chrome Web Store onayı almamıştır. Yayın öncesi PUBLISHING.md dosyasını incele.

## Doğrulama

npm run verify

30 otomatik test ve JavaScript sözdizimi kontrolleri geçti. [Chrome doğrulamasının kapsamı](VALIDATION.md).

Kaynak MIT lisanslıdır.
