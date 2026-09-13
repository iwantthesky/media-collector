# v0.5.1 doğrulama

14 Eylül 2026

- Format yardımcıları, popup, content script, background ve offscreen JavaScript sözdizimi kontrolleri geçti.
- 20 otomatik test geçti. Yeni kontroller format normalizasyonu, MP4 önceliği, kararlı aday sırası, gerçek dönüşüm kararı, Orijinal modda sessiz yeniden kodlamanın engellenmesi, MIME zinciri, ilk aday başarısız olduğunda sonraki adaya geçişi ve dönüşüm yüzdesinin geniş durum çubuğunda görünür kalmasını kapsıyor.
- Otomatik, Orijinal, MP4 ve WebM seçimleri popup ayarından seçim moduna aktarılıyor.
- Zorunlu dönüşümde dosya uzantısı MediaRecorder'ın gerçek MIME türüne göre belirleniyor.

Güncel sürümün gerçek Chrome seçim/indirme/sesli MP4-WebM dönüşüm kontrolü tamamlanmadan yayın hazır sayılmaz. Önceki YouTube motoru testi bu sürümün doğrulaması olarak kullanılmaz. Mağaza onayı veya hukuki inceleme yapılmış değildir.

Tarayıcı önizlemesi yalnız arayüz yerleşimini doğrular; gerçek indirme/dönüşüm testi değildir.
