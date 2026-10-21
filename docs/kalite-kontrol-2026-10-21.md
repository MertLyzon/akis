# Akış kalite kontrolü — 21 Ekim 2026

Bu rapor, 0.4.0 üzerindeki bu geliştirme oturumunun doğrulanmış kapsamını kaydeder.
Son kod grubu: dil seçicinin gerçek klavye davranışının düzeltilmesi ve tam tarayıcı doğrulaması.
Yeni bir ücretli servis, paket bağımlılığı, veritabanı şeması veya zamanlanmış iş eklenmedi.

## Güvenilirlik ve kullanıcı deneyimi

- Başarılı yazmadan sonra durum okunamazsa gönderinin eski kartı, takvimden açma ve
  ekran değiştirip geri gelme dahil, yeni bir başarılı okumaya kadar korunur.
  Şirket/oturum değişimi eski korumaları ve eski yanıtları yeni bağlama taşımaz.
- Manuel gönderim tekrarı, yalnızca hâlâ başarısız durumdaki satırı atomik olarak
  alabilir. Yarışı kaybeden istek başarılıymış gibi yanıt vermez.
- Ekip işlemlerinin hata bilgileri ilgili pencere/ekranda kalır. Sonucu belirsiz
  yazma istekleri için yeniden denemeden önce liste kontrolü açıklanır.
- Medya durumları ve eksik boyut bilgileri ortak kurallarla gösterilir; bilinmeyen
  durum işleniyormuş gibi sunulmaz. Büyük dosya uyarısı, önceki belirsiz yükleme
  uyarısını silmez.
- Kurulum penceresi çift tıklamaya ve iki bağımsız tarayıcı yanıtının farklı sırada
  başarısız olmasına karşı korunur. Kurulum kabulü doğrulanmadan başarı gösterilmez.
- Ekran araması Türkçe büyük/küçük harfleri ve Türkçe karaktersiz klavyeyi destekler.
  Dil seçici yerel radyo kontrolleri kullanır; ok tuşlarıyla seçim, gerçek odak,
  dil değişimi ve sonraki alana Tab geçişi Chromium üzerinde doğrulandı.
- Sistem kayıtları ve son eşitleme saati mevcut dil ve 12/24 saat tercihini kullanır;
  saat dilimi veya gönderim zamanı değiştirilmedi.
- Harici metin hazırlama giriş noktası kaydedilmemiş editör değişikliklerini de
  korur; kendisi kayıt, yükleme veya yayımlama yapmaz.
- Eksik İngilizce sabit mesajlar tamamlandı. Kullanıcı değerleri mesajlara tek
  geçişte, değişmeden eklenir; özel değiştirme karakterleri ve başka değişken adları
  dosya adını bozmaz. Bilinmeyen sözlük anahtarları prototip alanlarına dönüşmez.
- Beklenmedik nesne/dizi biçimindeki API hata alanları ham olarak gösterilmez;
  HTTP durum kodu korunur ve güvenli genel mesaj kullanılır. Yalnızca dolu metin
  biçimindeki destek kodları mesajlara eklenir.

## Sınırlı kaynakların korunması

- Otomatik yedekleme kodda ve `.env.example` içinde varsayılan olarak kapalıdır:
  `BACKUP_INTERVAL_DAYS=0`. Kullanıcı canlıda bu değişkenin tanımlı olmadığını bildirdi.
  Ayrı çalışan beat/worker servisleri de güncel koddan dağıtılmalıdır. Eski bir
  süreç veya pozitif ortam değeri için bu rapor kapalı olma garantisi vermez.
  Mevcut yedekler silinmedi; saklama sayısı azaltılmadı.
- Medya ve sistem ekranlarının otomatik okumaları gizli/çevrimdışı durumda durur,
  geri dönüldüğünde devam eder. Geçici medya okuma hatası takibi kalıcı olarak kesmez.
- Etiketli medya taraması küçük gruplar halinde yapılır ve 500 sonuçtan fazlasının
  yanıtı hazırlanmaz. Etiket filtresi sınırdan önce uygulanır; eski eşleşmeler
  kaybolmaz. Eşit tarihli dosyalar için kararlı ikinci sıralama anahtarı vardır.
- Service worker yalnızca uygulama kabuğunu, en fazla 80 kayıtla saklar. API,
  oturum ve medya önbelleğe alınmaz; depolama hataları çalışan ağ yanıtını bozmaz.
  Eski önbellek temizliği yalnızca Akış ad alanına uygulanır.
- Testler kendi geçici SQLite alanını temizler; önceki çalışma klasörleri ve gerçek
  uygulama verileri korunur. Harici test veritabanı yalnızca açıkça test adı taşıyan
  PostgreSQL adreslerini kabul eder; bu kontrol adresin gerçekten silinebilir bir
  test veritabanına ait olduğunu ayrıca doğrulama gereğini kaldırmaz.

## Gerçekten çalıştırılan kontroller

- `npm test`: **417 test geçti**, başarısız/atlanan yok.
- `npm run build`: TypeScript kontrolü ve Vite üretim derlemesi geçti.
- `.venv/bin/python -m pytest -q`: **252 test geçti, 1 test atlandı**; geçici SQLite.
- `git diff --check`: geçti.
- `sh -n deploy/nginx-entrypoint.sh start-local.sh`: geçti.
- `npx playwright test --reporter=line`: **79 senaryo geçti**; izole yerel SQLite
  ve Chromium, 2 işçi. Gerçek üretim kullanıcıları veya verileri kullanılmadı.
- Tarayıcı hazırlığı yerel test oturumunu başlatır; doğrudan hazırlık istekleri
  geçerli yerel Origin gönderir. Üretim kimlik doğrulaması veya CSRF kontrolü
  gevşetilmedi. Değişen düğme adları ve erişilebilir roller için seçiciler düzeltildi.

Yeni toplu birim testi komutu Windows/Unix kabuk farkına bağlı olmadan tüm
`scripts/*.test.mjs` dosyalarını bulur. Mevcut CI işi bu komutu kullanacak şekilde
güncellendi. Doğrudan dev/main push, mevcut workflow tetikleyicileri kapsamında
CI çalıştırmaz; bu oturumda CI veya yükleyici derleme işi başlatıldığı iddia edilmez.

## Tarayıcı ve dağıtım sınırları

- Sandbox içindeki Chromium macOS MachPort hatası verdi; izinli sandbox dışı
  çalıştırma ile tam Chromium paketi başarıyla tamamlandı. İşletim sistemi güvenlik
  ayarları değiştirilmedi. WebKit başarısı iddia edilmez.
- Ayarlar ekranının testte alınan gerçek görüntüsü incelendi; dil/saat kontrolleri,
  odak göstergesi ve platform kartlarının yerleşimi kontrol edildi.
- Manuel yerel tarayıcı kontrolü giriş ekranıyla sınırlıydı: parola göster/gizle,
  boşaltılınca tekrar gizleme, 390 px genişlikte yatay taşma olmaması ve 16 px alan
  yazı boyutu gözlendi. Giriş gönderilmedi; kimlik doğrulama aşılmadı.
- Yerel PostgreSQL, Docker yığını ve kurulum paketleri bu oturumda çalıştırılmadı.
  SQLite sonucu PostgreSQL sonucu olarak sunulmaz.
- Canlı `/api/ready` yanıtında veritabanı, Redis, worker, beat ve depolama ayrı ayrı
  kontrol edildi. Web servisinin `/api/health` vekil yolu da başarılı yanıt verdi.
  Her ana kod grubu için sürüm commit'i ve web paket adı karşılaştırıldı; yeni
  dağıtımın hazır olması yine ayrıca kontrol edilmelidir.
- Bu sağlık kontrolleri gerçek bir sosyal medya yayını, gerçek dosya yüklemesi veya
  uçtan uca iş akışı testi değildir. Üretimde içerik yayımlanmadı, kullanıcı/şirket
  oluşturulmadı ve yedekleme çağrısı yapılmadı.

## Sonraki doğrulama önceliği

İzole Chromium E2E paketi tamamlandı. Ayrı ve silinebilir PostgreSQL test
veritabanı/CI üzerinde arka uç paketini, Docker entegrasyonunu ve kurulum
paketlerini doğrulamak kalan kalite kapılarıdır. Bu sonuçlar tüm ortamlarda
hatasız çalışma garantisi değildir.
