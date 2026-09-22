# Akış 0.2 — Sosyal medya stüdyosu

Türkçe, tek çalışma alanlı sosyal medya uygulaması. React arayüzü; FastAPI, SQLAlchemy ve Alembic sunucusu; üretimde PostgreSQL, Redis ve Celery kullanır.

## Eklenen özellikler

- Sürükle-bırak veya dosyadan seçimle 100 MB'a kadar medya yükleme. Dosyalar kendi sunucunuzun kalıcı diskinde tutulur.
- HEIC/WebP dahil görselleri JPEG'e dönüştürme, yön düzeltme, Instagram için 4:5–1.91:1 oranı ve en fazla 1920×1080. Görsel kesilmez; gerektiğinde boşluk eklenir.
- TikTok için görselden 4 saniyelik, 1080×1920 H.264/AAC ve sessiz ses kanallı video üretme. Videolar da uygun biçime dönüştürülür.
- X parçalı medya yükleme; Instagram medya hazırlığını arka planda takip ederek yayımlama; TikTok doğrudan dosya aktarımı; WhatsApp medya, şablon parametreleri ve çoklu alıcı.
- Şifreli erişim/yenileme anahtarları, son geçerlilik tarihi, OAuth bağlantı penceresi, X/TikTok otomatik yenileme ve uygun Instagram uzun ömürlü token'larını yenileme.
- Platform ve WhatsApp alıcısı başına durum takibi. Geçici hatalarda ilk denemeden sonra üç tekrar; kalıcı hatalarda anlaşılır Türkçe açıklama. Sonucu belirsiz gönderimler yinelenen paylaşımı önlemek için otomatik tekrarlanmaz.
- İçerik isteği önce veritabanına kaydolur. API bekletmeden döner; worker gönderir. Redis kesintisinde kaydedilen işler zamanlanmış dağıtıcıyla yeniden alınır.

## Yerel kullanım

Python 3.12 ve Node.js 22.13+ gerekir. Windows'ta uygulama klasöründe `./Baslat.ps1`, macOS/Linux'ta `sh start-local.sh` çalıştırın. İlk açılış bağımlılıkları kurar; http://localhost:5173 adresini açın. Kapatmak için terminalde Ctrl+C kullanın.

Yerel kip yalnızca loopback adresinde çalışır; otomatik oturum açar, SQLite ve veritabanına kayıtlı arka plan işleyicisini kullanır. Bu kipte de bağlı hesaplara gerçek gönderim yapılabilir. Yerel portu internete açmayın. Sunucuya kurulumda aşağıdaki Docker kipi parola gerektirir.

`scripts/bootstrap.py`, mevcut dosyaları ezmeden `.env` anahtarlarını ve ilk sunucu giriş parolasını `.local-admin-password` dosyasında oluşturur. Bu dosyaları paylaşmayın. Var olan kurulumdaki eski D1 kayıtları `scripts/import_legacy.py` ile bir kez yerel veritabanına aktarılır. Eski belirsiz/bekleyen gönderimler otomatik gönderilmez.

## Windows ve Mac için Docker kurulumu

Docker Desktop/Compose ve ilk anahtarları üretmek için Python gerekir. Uygulama klasöründe:

```sh
python scripts/bootstrap.py
docker compose up --build -d
```

macOS'ta ilk komut için `python3` kullanabilirsiniz. http://localhost:8080 adresini açın; `.local-admin-password` dosyasındaki parolayla giriş yapın. Compose ayrı PostgreSQL, Redis, API, migration, worker, beat ve web servisleri oluşturur. Sistem ffmpeg'i imaja dahildir.

Sunucuda HTTPS ters proxy kurup `.env` içine `APP_ORIGIN=https://kendi-alan-adiniz` ve `PUBLIC_BASE_URL=https://kendi-alan-adiniz` ekleyin, servisleri yeniden oluşturun. Compose web portu 127.0.0.1:8080'e bağlıdır; HTTPS proxy bu porta yönlenmelidir. LOCAL_MODE üretimde false kalmalıdır. Bu paket sunucuya otomatik yayımlanmış değildir.

Yerel SQLite veritabanı ve Compose PostgreSQL veritabanı ayrıdır. Docker ilk açılışta boş çalışma alanı oluşturur; yerel kayıtları veya medyayı kendiliğinden taşımaz. Geçiş yapmadan önce yedek alın; mevcut yerel uygulama kullanılmaya devam edilebilir.

## Uygulama içi bağlantı kurulumu

1. **Ayarlar**: Platformun geliştirici uygulamasından Client ID / Client key, gizli anahtar ve dönüş adresini girin. Dönüş adresi platform paneliyle birebir aynı olmalıdır.
2. **Bağlantılar**: Hesabı OAuth penceresinde bağlayın veya mevcut erişim token'ı, varsa yenileme token'ı ve son kullanma tarihini girin. API key tek başına kullanıcı adına paylaşım yapmaya yetmez. Eski token'ların bilinmeyen son kullanma tarihleri tahmin edilmez.
3. **İçerik oluştur**: Dosyayı yükleyin, hazırlanınca önizlemeyi kontrol edin, kanalları seçin ve paylaşımı başlatın.
4. **Gönderiler**: Her kanalın ve WhatsApp alıcısının sonucunu takip edin. Belirsiz sonuçta yeniden göndermeden önce platform hesabını kontrol edin.

Platform koşulları:

- **Instagram**: Profesyonel hesap, gerekli yayımlama izinleri ve sunucuya herkese açık HTTPS erişimi gerekir. Ayarlar'daki medya adresi bu sunucuya yönlenmelidir; localhost çalışmaz. Medya indirme bağlantıları süreli ve imzalıdır.
- **TikTok**: Login Kit türünü Web veya Desktop olarak doğru seçin. Web için HTTPS dönüş adresi gerekir; Desktop akışında PKCE uygulanır. `video.upload` izniyle dosya gelen kutusuna aktarılır; son yayımlama TikTok uygulamasında kullanıcı tarafından tamamlanır. Dosya doğrudan yüklendiği için PULL_FROM_URL alan adı doğrulamasına ihtiyaç duyulmaz.
- **X**: Kullanıcı OAuth 2.0 token'ı, içerik/medya izinleri ve otomatik yenileme için `offline.access` gerekir. Hesabın API erişim planı ve platform kotaları geçerlidir.
- **WhatsApp**: Phone Number ID gerekir. Şablon adı, onaylı dil, gövde parametreleri ve medya başlığı eşleşmelidir. Serbest mesaj yalnızca kullanıcının son 24 saat içinde başlattığı oturumda gönderilebilir; uygulamada bu durum onaylanır. Test numaraları Meta alıcı listesinde olmalıdır. “Kabul edildi” teslim/okundu anlamına gelmez; webhook teslim takibi yoktur.

## Veri ve güvenlik

Erişim ve yenileme token'ları ile uygulama gizli anahtarları AES-GCM ile şifrelenir, okuma API'sinde geri verilmez. `CREDENTIAL_KEY` kaybedilirse kayıtlı anahtarlar çözülemez. Anahtarı rastgele değiştirerek mevcut veritabanını kullanmayın.

Yerelde `.env` ve `data/` klasörünü; Docker'da PostgreSQL yedeğini, `media` hacmini ve `.env` dosyasını birlikte ve erişimi kısıtlı biçimde yedekleyin. `docker compose down -v` veritabanı ve medya hacimlerini siler; normal durdurma için `docker compose down` kullanın.

Bu sürüm tek yönetici/çalışma alanı içindir; ekip üyeliği ve çok kullanıcılı yetkilendirme içermez. Disk kotası/yaşam döngüsü, TLS ve sunucu yedekleme işletmecinin kurulumuna bağlıdır.

## Geliştirme ve doğrulama

Aktif kod: `app/page.tsx`, `app/studio/`, `backend/akis/`, `backend/migrations/`. Önceki Cloudflare sürümünün yerel klasörde kalan dosyaları yeni sunucu tarafından kullanılmaz; dağıtım kaynağı paketi yalnızca yeni uygulamayı içerir.

```sh
python -m pytest backend/tests -q
npm run build
python -m alembic -c backend/alembic.ini upgrade head
```

Python komutlarını bağımlılıkların kurulu olduğu sanal ortamda çalıştırın. Alembic için `PYTHONPATH=backend` gerekir; başlatıcı bunu ayarlar.

Doğrulama: 28 otomatik test geçti; gerçek HEIC/WebP ve ffmpeg dönüşümü, token şifreleme/yenileme, OAuth durum doğrulaması, kuyruk/tekrar davranışı, medya yükleme ve platform istek biçimleri kontrol edildi. Celery testi bellek broker'ıyla çalıştı. TypeScript ve üretim derlemesi geçti, tarayıcıda ekranlar kontrol edildi. Bu bilgisayarda Docker bulunmadığından Compose/PostgreSQL/Redis birlikte çalıştırılmadı. Gerçek hesaplarda OAuth ve canlı paylaşım testleri yapılmadı; platform yanıtları testlerde taklit edildi.
