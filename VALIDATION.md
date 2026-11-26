# v0.5.4 doğrulama

26 Kasım 2026

- `npm run verify` ile JavaScript sözdizimi ve 30 otomatik test geçti.
- Sessiz, ayrı bir Chrome profilinde üç hız kademesi, uyarının popup'a sığması, ayarın yeniden açılışta korunması ve eski özel değerin yüklenmesi doğrulandı.
- Yerel HTTP sunucusunda video taraması, uzantısız HLS yakalama ve 1, 3, 6 eşzamanlı HLS isteği doğrulandı. Çıkan MPEG-TS dosyalarında FFprobe ses, görüntü ve süreyi doğruladı.
- Aynı testte kısa `Retry-After` süresine uyuldu. Uzun süre ve `403` yanıtında ilk parçada işlem durdu. Dengeli kademede 7 MP4 dosyasının tamamı indirildi ve tepe eşzamanlılık 3 olarak ölçüldü.

Bu sürümdeki Chrome kontrolü yerel örneklerle yapıldı. Gerçek platform akışları ve WebM ekran kaydı bu koşuda ayrıca denenmedi.

# v0.5.3 doğrulama

14 Eylül 2026

- Format yardımcıları, popup, content script, background ve offscreen JavaScript sözdizimi kontrolleri geçti.
- 25 otomatik test geçti. Yeni kontroller Scroll + Tara'nın eski URL tabanlı video toplayıcısını dönüştürme durumundan bağımsız kullanmasını, bozuk MP4 kayıt yolunun reddini, MP4 seçimindeki güvenli WebM fallback'ini, çözünürlük tabanlı bit hızını, tek sonlandırılmış Blob'u, numaralı adı ve eski `overwrite=true` ayarına rağmen bütün medya yollarında `uniquify` kullanılmasını kapsıyor.
- Otomatik, Orijinal, MP4 ve WebM seçimleri popup ayarından seçim moduna aktarılıyor.
- Yerel örneklerden iki MP4 dosyası FFmpeg tam çözme kontrolünde 861 ve 645 H.264 hata satırı üretti; temas sayfasında yaklaşık dördüncü saniyeden sonra ağır blok bozulması görüldü. Karşılaştırılan WebM dosyasında VP9 çözme hatası görülmedi.

Güncel sürümün gerçek Chrome seçim/indirme/sesli WebM kayıt kontrolü tamamlanmadan yayın hazır sayılmaz. Doğrudan MP4 ayrıca bozulmadan indirilmelidir; MP4 seçeneği doğrudan MP4 bulamazsa bozuk MP4 üretmeden WebM kaydına düşmelidir. Önceki YouTube motoru testi bu sürümün doğrulaması olarak kullanılmaz. Mağaza onayı veya hukuki inceleme yapılmış değildir.

Tarayıcı önizlemesi yalnız arayüz yerleşimini doğrular; gerçek indirme/dönüşüm testi değildir.
