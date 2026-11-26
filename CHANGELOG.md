# v0.5.4 — 2026-11-26

- Toplu dosya ve HLS indirmeleri için Düşük, Dengeli ve Yüksek hız kademeleri eklendi. Varsayılan kademe 3 eşzamanlı işlem kullanır.
- Hız ayarına erişim kısıtı ve hesap engeli uyarısı eklendi.
- İlk HLS parçası çıktıya doğrudan eklenir. Erişim reddinde indirme durur ve uzun `Retry-After` süreleri kullanıcıya gösterilir.
- HLS ve DASH listeleri, adres uzantısı bulunmadığında HTTP yanıt türünden tanınabilir.

# v0.5.3 — 2026-09-15

- Scroll + Tara video toplama yolu, Personal Media Downloader v0.2.0'daki kanıtlanmış URL tabanlı tarayıcıdan ayrı bir işlev olarak geri aktarıldı.
- Toplu tarama artık etkileşimli video dönüştürme durumuna bağlı değil; yeni seçim ve WebM fallback davranışı korunuyor.

# v0.5.2 — 2026-09-14

- Medya indirmelerinde üzerine yazma kaldırıldı. Aynı ad yeniden kullanılırsa Chrome otomatik numara ekler; kaydedilen videolar ayrıca sıra numarası ve kısa medya kimliği alır.
- Gerçek Chrome MP4 kayıtlarında yüzlerce H.264 çözme hatası ve dördüncü saniyeden sonra görünür blok bozulması doğrulandı. Bozuk gerçek zamanlı MP4 kaydı kapatıldı; doğrudan MP4 indirme korunurken kayıt fallback'i WebM kullanır.
- MP4 seçimi doğrudan MP4 bulunamadığında artık tamamen hata vermiyor; bozuk MP4 üretmeden güvenli WebM kaydına düşüyor ve sonuç çubuğunda bunu bildiriyor.
- MediaRecorder tek sonlandırılmış Blob üretir ve çözünürlüğe göre 4–20 Mbps video / 192 kbps ses hedefi kullanır.

# v0.5.1 — 2026-09-14

- Gerçek zamanlı video dönüşümünde yüzde bilgisi durum metninin başına alındı; daralmada da görünür kalır.
- Sayfa içi seçim ve indirme çubuğu genişletildi; uzun dönüşüm durumu için daha fazla alan ayrıldı.

# v0.5.0 — 2026-09-13

- Tıklayarak seçim düğmesinin yanına Otomatik, Orijinal, MP4 ve WebM video biçimi seçicisi eklendi.
- Otomatik mod doğrudan MP4 adaylarını önce, ardından diğer adayları kalite sırasıyla dener.
- İlk doğrudan aday başarısız olursa aynı medya için sonraki aday denenir.
- Zorunlu MP4/WebM seçiminde doğrudan hedef kapsayıcı yoksa seçilen oynatıcı gerçek zamanda MediaRecorder ile dönüştürülür.
- Kaydedilen dosyanın uzantısı gerçek MediaRecorder MIME türünden belirlenir; yalnız uzantı değiştirilmez.

# v0.4.1 — 2026-09-06

- Site bölümleri kaldırıldı, tek arayüze dönüldü.
- Genel görsel/video tıklayarak seçim korundu.
- Siteye özel pano listesi ve YouTube yerel indirme modülü kaldırıldı.
- nativeMessaging izni ve kaynak paketten harici yardımcı çıkarıldı.
- Gizlilik, yayın notları ve LinkedIn taslağı yeni kapsama göre güncellendi.
