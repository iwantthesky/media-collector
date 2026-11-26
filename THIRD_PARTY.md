# Teknik kaynaklar

Bu sürüm harici yerel indirme/dönüştürme motoru veya üçüncü taraf ikili dağıtmaz. Doğrudan adresi olmayan videonun WebM kaydı desteklendiği yerde Chrome MediaRecorder API'siyle cihaz üzerinde yapılır; gerçek zamanlı MP4 kaydı kullanılmaz.

https://developer.chrome.com/docs/extensions/
https://developer.mozilla.org/docs/Web/API/MediaRecorder
https://developer.chrome.com/docs/webstore/user_data

İstek sınırları ve uzantısız medya listelerinin tespiti için kullanılan referanslar.

- [RFC 6585, HTTP 429](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)
- [RFC 9110, Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
- [Chrome webRequest, yanıt başlıkları](https://developer.chrome.com/docs/extensions/reference/api/webRequest#event-onHeadersReceived)

26 Kasım 2026 incelemesinde canlı HLS'te anahtar önceden yükleme ve zamanlanmış aralıklar ile tarayıcıda HLS okuma ve MP4 çıktısı değerlendirildi. [Apple HLS 2026 notları](https://developer.apple.com/streaming/Whats-new-HLS.pdf) · [Mediabunny HLS desteği](https://mediabunny.dev/blog/mediabunny-now-supports-hls)

Geliştirme ve otomatik testler Node.js 22+ kullanır. Kaynak kod MIT lisanslıdır.
