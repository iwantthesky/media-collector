# Yayın kontrolü — v0.5.4

- [x] Tek arayüz; görsel/video için tıklayarak seçim.
- [x] Site bölümleri, ayrı pano listesi ve yerel YouTube indirme modülü çıkarıldı.
- [x] nativeMessaging izni kaldırıldı; kaynak paketinde yerel yardımcı yok.
- [x] Otomatik/Orijinal/MP4/WebM format seçicisi ve MP4-öncelikli aday sırası eklendi.
- [x] Medya dosyalarında üzerine yazma kapatıldı; kayıt adları numaralandırıldı.
- [x] Bozuk Chrome MP4 MediaRecorder fallback'i kapatıldı; MP4 seçiminde doğrudan MP4 yoksa güvenli WebM yedeği kullanılıyor.
- [x] 30 otomatik test ve sözdizimi kontrolleri geçti.
- [x] Ayrı Chrome profilinde doğrudan MP4, hız ayarları, sesli HLS ve sunucu sınırlaması senaryoları.
- [ ] Gerçek platformlarda genel görsel ve sesli WebM kayıt senaryoları.
- [ ] Güncel mağaza izin/gizlilik beyanları ve ürünün gerçek işlevlerinin hukuki incelemesi.
- [x] [GitHub deposu](https://github.com/iwantthesky/media-collector) ve [gizlilik politikası](PRIVACY.md).

LinkedIn taslağı geliştirme sürecini anlatır; yayınlanmış mağaza ürünü veya hukuki güvence iddiası içermez. Demoda kendi içeriklerini ve izinli erişim yöntemlerini kullan. Ürün adını veya bölüm adlarını değiştirmek tek başına telif ya da platform koşullarına ilişkin riski kaldırmaz.

GitHub geliştirme paketi için `scripts/package.ps1` ile Chrome ve kaynak ZIP'lerini oluştur. Test kapsamı [VALIDATION.md](VALIDATION.md) içinde kayıtlıdır.
