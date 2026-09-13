# Media Collector v0.5.1

Web sayfalarında görsel/video seçme ve dosyaları düzenli klasörlere kaydetme üzerine geliştirilen Chrome MV3 prototipi.

**Geliştirme sürümü — Chrome Web Store yayını değildir.**

[Chrome ZIP indir](https://github.com/iwantthesky/media-collector/raw/refs/heads/main/downloads/Media-Collector-v0.5.1-chrome.zip) · [Kaynak ZIP indir](https://github.com/iwantthesky/media-collector/raw/refs/heads/main/downloads/Media-Collector-v0.5.1-source.zip)

## Kurulum

Chrome ZIP dosyasını kalıcı bir klasöre çıkar. Chrome'da chrome://extensions sayfasını aç. Geliştirici modunda Paketlenmemiş öğe yükle ile `manifest.json` içeren klasörü seç. Mevcut kurulum güncelleniyorsa Yeniden yükle düğmesine bas ve açık medya sayfalarını yenile. Yerel yardımcı kurulumu gerekmez.

## Kullanım

- **Sayfadan tıklayarak seç:** Yanındaki video biçimini belirle, görsel ve videoları seç, sayfadaki Seçilenleri indir düğmesine bas. Esc seçimden çıkar.
- **Video biçimi:** Otomatik mod doğrudan MP4 adayını önce dener, sonra diğer doğrudan biçimlere geçer. Orijinal kaynak, zorunlu MP4 ve zorunlu WebM seçenekleri de vardır.
- **Tarama:** Hızlı tara, Videoları tara veya Kaydır + tara ile sayfadaki öğeleri bul.
- **Doğrudan adres:** Medya dosyası adresi gir. Normal web sayfası adresleri dosya bağlantısı değildir.
- **Yakalama:** Varsayılan kapalıdır; yalnızca kullanıcının başlattığı sekmede geçici medya adresleri tutulur.
- **Ayarlar:** Toplu dosyalarda varsayılan 3 paralel indirme, ayarlanabilir 1–6. HLS 6 paralel parça kullanır; sunucu bekleme kuralları korunur.
- **Gizlilik:** Geçici adresleri ve önceki sürümlerden kalan URL alanlarını temizle. Bu işlem indirilmiş dosyaları veya Chrome indirme geçmişini silmez.

Siteye özel arayüz bölümleri, pano listesi modu ve YouTube yerel indirme yardımcısı bu sürümden çıkarılmıştır. YouTube sayfalarında tarama/seçim desteklenmez; sayfa ve CDN parça adresleri doğrudan dosya olarak indirilmez. Genel medyayı tanıyan mevcut sayfa içi tarama kodu korunur.

## Sınırlar

Her sitede çalışması garanti edilmez. Doğrudan hedef biçim bulunamadığında MP4/WebM dönüşümü, seçilen oynatıcı akışının MediaRecorder ile gerçek zamanda yeniden kodlanmasıdır; yalnızca uzantı değiştirilmez. Kullanılabilir kapsayıcı ve ses desteği Chrome/işletim sistemi yeteneklerine ve sayfanın izinlerine bağlıdır. Ayrı sesli HLS ve DASH birleştirme tamamlanmış değildir. DRM aşma desteği yoktur. Yalnızca gerekli kullanım haklarına ve izinlere sahip olduğun içeriklerde kullan.

Arayüz adlarını kaldırmak hukuki uygunluk veya mağaza onayı sağlamaz. Ürün henüz Chrome Web Store onayı almamıştır. Yayın öncesi PUBLISHING.md dosyasını incele.

## Doğrulama

npm run verify

20 otomatik test ve JavaScript sözdizimi kontrolleri geçti. Sayfadan seçim, gerçek dosya indirme ve sesli MP4/WebM dönüşümü için canlı Chrome kontrolü ayrıca gereklidir. Ayrıntılar VALIDATION.md dosyasında.

Paylaşım için v0.5.1 source ZIP kullan. Önceki sürümler farklı özellikler içerir. LinkedIn taslağı LINKEDIN_POST_TR.md dosyasındadır. Kaynak MIT lisanslıdır.
