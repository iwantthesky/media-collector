# Gizlilik politikası

6 Eylül 2026 — v0.4.1

Media Collector geliştirici sunucusu, kullanıcı hesabı, reklam SDK'sı veya analiz/telemetri sistemi kullanmaz. Aktif sayfa ve medya adreslerini yalnızca kullanıcının başlattığı tarama, seçim ve indirme işlemleri için işler.

## Saklama ve temizleme

Klasör/tarama/paralellik tercihleri chrome.storage.local içinde saklanır. Medya URL alanları kalıcı kaydedilmez; önceki sürümlerin boardUrls ve mediaUrls kayıtları popup açılırken silinir. Kullanıcının başlattığı sekme yakalama listesi chrome.storage.session içinde tutulur. Yakalama varsayılan kapalıdır; durdurma veya sekme kapanması ilgili listeyi siler. Sayfa değişiminde eski liste temizlenir; açık onay aynı sekmede devam eder.

Geçici adresleri sil düğmesi tüm sekmelerde yakalamayı kapatır ve geçici listeleri temizler. İndirilen dosyalar, klasör adları, hata raporları ve Chrome'un kendi indirme geçmişi ayrı yönetilir; bu düğme bunları silmez. Hata raporları özel medya URL'lerini ve pin kimliklerini içermez. Ham HLS tanı mesajları konsola gönderilmez.

## İletişim ve izinler

Tarayıcı içeriğin bulunduğu sunucuyla doğrudan iletişim kurar. Bu sunucular normal ağ isteği sırasında IP adresini ve standart istek bilgilerini görebilir. Eklenti işlediği verileri geliştiriciye veya analiz hizmetlerine göndermez. Sitelerle iletişim kendi koşullarına tabidir.

HTTP/HTTPS erişimi sayfa içeriğini taramak ve medya sunucularına ulaşmak içindir. tabs/scripting sayfa seçim aracını çalıştırır; downloads indirmeleri yönetir; storage yerel tercihleri tutar; webRequest kullanıcının başlattığı sekme yakalamasını sağlar; declarativeNetRequest HLS referer başlığını geçici yönetir; offscreen HLS parça birleştirmesi içindir. Geniş site erişimi bu sürümde hâlâ bulunur. Kamera, mikrofon, cookies, history ve nativeMessaging izinleri istenmez. Sayfadaki videodan kayıt, kamera veya mikrofon kaydı değildir.

v0.4.1 yerel indirme yardımcısı çağırmaz. Veriler reklam, satış, kredi değerlendirmesi veya geliştiricinin insan incelemesi amacıyla kullanılmaz; yalnızca belirtilen özellikleri sunmak için işlenir. Bu kullanım Chrome Web Store Kullanıcı Verileri Politikası'nın Sınırlı Kullanım koşullarına bağlıdır; mağaza onayı ayrı süreçtir.

Soruları projenin Issues bölümüne iletebilirsiniz. Kişisel medya adreslerini veya oturum bilgilerini herkese açık paylaşmayın.
