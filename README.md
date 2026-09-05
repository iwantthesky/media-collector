# Media Collector v0.4.1

Web sayfalarında görsel/video seçme ve dosyaları düzenli klasörlere kaydetme üzerine geliştirilen Chrome MV3 prototipi.

## Kurulum

Chrome'da chrome://extensions sayfasını aç. Geliştirici modunda Paketlenmemiş öğe yükle ile bu klasörü seç. Mevcut kurulum güncelleniyorsa Yeniden yükle düğmesine bas ve açık medya sayfalarını yenile. Yerel yardımcı kurulumu gerekmez.

## Kullanım

- **Sayfadan tıklayarak seç:** Görsel ve videoları seç, sayfadaki Seçilenleri indir düğmesine bas. Esc seçimden çıkar.
- **Tarama:** Hızlı tara, Videoları tara veya Kaydır + tara ile sayfadaki öğeleri bul.
- **Doğrudan adres:** Medya dosyası adresi gir. Normal web sayfası adresleri dosya bağlantısı değildir.
- **Yakalama:** Varsayılan kapalıdır; yalnızca kullanıcının başlattığı sekmede geçici medya adresleri tutulur.
- **Ayarlar:** Toplu dosyalarda varsayılan 3 paralel indirme, ayarlanabilir 1–6. HLS 6 paralel parça kullanır; sunucu bekleme kuralları korunur.
- **Gizlilik:** Geçici adresleri ve önceki sürümlerden kalan URL alanlarını temizle. Bu işlem indirilmiş dosyaları veya Chrome indirme geçmişini silmez.

Siteye özel arayüz bölümleri, pano listesi modu ve YouTube yerel indirme yardımcısı bu sürümden çıkarılmıştır. YouTube sayfalarında tarama/seçim desteklenmez; sayfa ve CDN parça adresleri doğrudan dosya olarak indirilmez. Genel medyayı tanıyan mevcut sayfa içi tarama kodu korunur.

## Sınırlar

Her sitede çalışması garanti edilmez. Blob video fallback'i oynatıcıdan gerçek zamanlı WebM kaydıdır; ses ve kayıt sayfanın izinlerine bağlıdır. Ayrı sesli HLS ve DASH birleştirme tamamlanmış değildir. DRM aşma desteği yoktur. Yalnızca gerekli kullanım haklarına ve izinlere sahip olduğun içeriklerde kullan.

Arayüz adlarını kaldırmak hukuki uygunluk veya mağaza onayı sağlamaz. Ürün henüz Chrome Web Store onayı almamıştır. Yayın öncesi PUBLISHING.md dosyasını incele.

## Doğrulama

npm run verify

9 otomatik test ve JavaScript sözdizimi kontrolleri geçti. Sayfadan seçim, gerçek dosya indirme ve ses için güncel sürümün canlı kontrolleri devam ediyor. Ayrıntılar VALIDATION.md dosyasında.

Paylaşım için v0.4.1 source ZIP kullan. Önceki sürümler farklı özellikler içerir. LinkedIn taslağı LINKEDIN_POST_TR.md dosyasındadır. Kaynak MIT lisanslıdır.
