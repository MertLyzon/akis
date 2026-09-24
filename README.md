# Akış 0.3 — Sosyal medya stüdyosu

Türkçe, çok şirketli sosyal medya uygulaması. React arayüzü; FastAPI, SQLAlchemy ve Alembic sunucusu; üretimde PostgreSQL, Redis ve Celery kullanır.

## 0.3 ile gelenler: şirket kullanımı

- **Şirket çalışma alanları**: Her şirketin hesapları, içerikleri, medyası ve uygulama ayarları birbirinden ayrı tutulur. Bir kişi birden fazla şirkete üye olabilir; kenar çubuğundan şirket değiştirilir.
- **Kullanıcılar ve roller**: Şirket yöneticisi, onaylayan, editör, görüntüleyen. Yeni üyeye geçici parola verilir; ilk girişte kendi parolasını belirlemeden hiçbir işlem yapamaz.
- **Paylaşım onayı**: Editörün hazırladığı içerik "Onay bekliyor" durumuna geçer; onaylayan veya yönetici onayladığında yayımlanır, reddedilirse not ile editöre döner. Şirket ayarlarından kapatılabilir.
- **Takvim ve zamanlama**: İçerik ileri bir tarihe planlanır; saatler şirketin saat dilimine göre yorumlanır. Takvim ekranı aylık görünüm sunar; plan gönderim başlamadan iptal edilebilir.
- **İşlem geçmişi**: Kim giriş yaptı, kim içeriği değiştirdi, kim onayladı, kim hangi hesabı bağladı. Anahtarlar bu kayıtlara yazılmaz.
- **Gönderim takibi**: Her kanalın her denemesi kaydedilir: hangi aşamada kaldı (hazırlık, medya yükleme, yayımlama), kaç kez denendi, neden başarısız oldu.
- **Medya kütüphanesi**: Klasör, etiket, arama ve arşiv. Dosyalar tekrar yüklenmeden yeni içeriklerde kullanılır.
- **Yönetim panelleri**: *Şirket yönetimi* ekibi, rolleri, onay kuralını, kullanımı ve işlem geçmişini gösterir. *Sistem yönetimi* şirketleri, kuyruğu, hataları, depolama tüketimini ve servis sağlığını gösterir; müşterilerin erişim anahtarlarını göremez.
- **İki aşamalı giriş** (TOTP; Google/Microsoft Authenticator, 1Password, Authy), **otomatik günlük yedek** ve **yedekten geri yükleme kontrolü**.
- **Cloudinary medya depolama**: Hazırlanan görsel ve videolar Cloudinary'ye yüklenir. Instagram dosyayı oradan okur, bu yüzden ayrıca herkese açık sunucu adresi gerekmez.

## Önceki sürümden gelen özellikler

- Sürükle-bırak veya dosyadan seçimle 100 MB'a kadar medya yükleme. Dosyalar kendi sunucunuzun kalıcı diskinde tutulur.
- HEIC/WebP dahil görselleri JPEG'e dönüştürme, yön düzeltme, Instagram için 4:5–1.91:1 oranı ve en fazla 1920×1080. Görsel kesilmez; gerektiğinde boşluk eklenir.
- TikTok için görselden 4 saniyelik, 1080×1920 H.264/AAC ve sessiz ses kanallı video üretme. Videolar da uygun biçime dönüştürülür.
- X parçalı medya yükleme; Instagram medya hazırlığını arka planda takip ederek yayımlama; TikTok doğrudan dosya aktarımı; WhatsApp medya, şablon parametreleri ve çoklu alıcı.
- Şifreli erişim/yenileme anahtarları, son geçerlilik tarihi, OAuth bağlantı penceresi, X/TikTok otomatik yenileme ve uygun Instagram uzun ömürlü token'larını yenileme.
- Platform ve WhatsApp alıcısı başına durum takibi. Geçici hatalarda ilk denemeden sonra üç tekrar; kalıcı hatalarda anlaşılır Türkçe açıklama. Sonucu belirsiz gönderimler yinelenen paylaşımı önlemek için otomatik tekrarlanmaz.
- İçerik isteği önce veritabanına kaydolur. API bekletmeden döner; worker gönderir. Redis kesintisinde kaydedilen işler zamanlanmış dağıtıcıyla yeniden alınır.

## Yerel kullanım

Python 3.12 ve Node.js 22.13+ gerekir. Windows'ta uygulama klasöründe `./Baslat.ps1`, macOS/Linux'ta `sh start-local.sh` çalıştırın. İlk açılış bağımlılıkları kurar; http://localhost:5173 adresini açın. Kapatmak için terminalde Ctrl+C kullanın.

Yerel kip yalnızca loopback adresinde çalışır; sistem yöneticisi olarak otomatik oturum açar (başka bir kullanıcıyı denemek için çıkış yapın), SQLite ve veritabanına kayıtlı arka plan işleyicisini kullanır. `.env` içinde `DATABASE_URL` verilirse yerel kip de o PostgreSQL'e bağlanır. Bu kipte de bağlı hesaplara gerçek gönderim yapılabilir. Yerel portu internete açmayın. Sunucuya kurulumda aşağıdaki Docker kipi parola gerektirir.

`scripts/bootstrap.py`, mevcut dosyaları ezmeden `.env` anahtarlarını ve ilk sunucu giriş parolasını `.local-admin-password` dosyasında oluşturur. Bu dosyaları paylaşmayın. İlk açılışta `ADMIN_EMAIL` (varsayılan `admin@akis.local`) ve `ADMIN_PASSWORD_HASH` ile sistem yöneticisi ve ilk şirket oluşturulur. 0.2 veritabanı yükseltildiğinde tüm eski kayıtlar bu ilk şirkete taşınır. Var olan kurulumdaki eski D1 kayıtları `scripts/import_legacy.py` ile bir kez yerel veritabanına aktarılır. Eski belirsiz/bekleyen gönderimler otomatik gönderilmez.

## Windows ve Mac için Docker kurulumu

Docker Desktop/Compose ve ilk anahtarları üretmek için Python gerekir. Uygulama klasöründe:

```sh
python scripts/bootstrap.py
docker compose up --build -d
```

macOS'ta ilk komut için `python3` kullanabilirsiniz. http://localhost:8080 adresini açın; `.local-admin-password` dosyasındaki parolayla giriş yapın. Compose ayrı PostgreSQL, Redis, API, migration, worker, beat ve web servisleri oluşturur. Sistem ffmpeg'i imaja dahildir.

Sunucuda HTTPS ters proxy kurup `.env` içine `APP_ORIGIN=https://kendi-alan-adiniz` ve `PUBLIC_BASE_URL=https://kendi-alan-adiniz` ekleyin, servisleri yeniden oluşturun. Compose web portu 127.0.0.1:8080'e bağlıdır; HTTPS proxy bu porta yönlenmelidir. LOCAL_MODE üretimde false kalmalıdır. Bu paket sunucuya otomatik yayımlanmış değildir.

Yerel SQLite veritabanı ve Compose PostgreSQL veritabanı ayrıdır. Docker ilk açılışta boş çalışma alanı oluşturur; yerel kayıtları veya medyayı kendiliğinden taşımaz. Geçiş yapmadan önce yedek alın; mevcut yerel uygulama kullanılmaya devam edilebilir.

## Uygulamalar: Windows, macOS, Linux, Android, iPhone

Windows, macOS, Linux ve Android uygulamaları [Tauri 2](https://tauri.app) ile aynı React arayüzünden üretilir (`src-tauri/`). Arayüz uygulamanın içinde gelir; veriler şirketin **barındırılan Akış sunucusunda** durur. Uygulama ilk açılışta sunucu adresini sorar (ör. `https://akis.sirketin.com`) ve web sürümüyle aynı hesaplarla giriş yapılır.

- Uygulamalar çerez yerine imzalı oturum anahtarıyla (`Authorization: Bearer`) çalışır; anahtar parola veya 2FA değişince geçersiz olur. Sunucu yalnızca `APP_CLIENT_ORIGINS` listesindeki uygulama kaynaklarına CORS izni verir.
- Sosyal medya hesabı bağlama (OAuth) güvenlik nedeniyle sistem tarayıcısında, web sürümünde yapılır; uygulama o sayfayı açar.
- Telefonlar düz `http://` adreslerine bağlanmaz; sunucunun HTTPS olması gerekir.

**iPhone ve diğer cihazlar: ana ekrana eklenen web uygulaması (PWA), ücretsiz.** Apple Developer hesabı veya Mac gerekmez. iPhone'da sunucu adresini Safari'de açın, **Paylaş → Ana Ekrana Ekle**'ye dokunun; Akış simgesiyle tam ekran açılır. Android/Chrome/Edge'de uygulama içinde **Yükle** düğmesi çıkar. Güncellemeler sunucu güncellenince herkese ulaşır. Service worker (`public/sw.js`) yalnızca uygulama kabuğunu önbelleğe alır; `/api` isteklerini, medyayı ve oturumu hiçbir zaman saklamaz. Kurulum için sunucunun HTTPS olması gerekir. Yeni bir sürümde kabuk dosyaları değiştiyse `sw.js` içindeki `CACHE` adını artırın.

**Masaüstü ve Android paketleri: GitHub'da derleme (önerilen):** Actions sekmesinde **Uygulamalar → Run workflow**. Testler geçerse Windows (`.msi`, `.exe`), macOS (evrensel `.dmg`; genel depolarda GitHub'ın Mac makineleri ücretsizdir, imzasız paket ilk açılışta sağ tık → Aç ile açılır), Linux (`.deb`, `.rpm`, `.AppImage`) ve Android (`.apk`) paketleri çalıştırmanın *Artifacts* bölümüne düşer. `v0.3.0` gibi bir etiket göndermek de derlemeyi başlatır.

**Kendi bilgisayarında:** [Rust](https://rustup.rs) ve platform gereksinimleri ([Tauri önkoşulları](https://tauri.app/start/prerequisites/): Windows'ta VS Build Tools, Linux'ta webkit2gtk) kurulduktan sonra:

```sh
npm run app:dev        # masaüstü, canlı yenilemeyle
npm run app:build      # bu işletim sisteminin kurulum paketi
npm run android:build  # Android Studio + SDK/NDK gerekir (önce: npx tauri android init)
npm run ios:build      # yalnızca macOS + Xcode (önce: npx tauri ios init)
```

**İmzalama ve mağazalar:** CI'daki Android paketi doğrudan telefona kurulabilen hata ayıklama imzalıdır; Google Play için bir keystore ile release imzası gerekir. iPhone uygulaması Apple Developer hesabı (yıllık ücretli) ve Mac gerektirir; TestFlight/App Store dağıtımı bu hesapla yapılır. İmzasız macOS/Windows paketleri ilk açılışta işletim sistemi uyarısı gösterir; kod imzalama sertifikalarıyla kaldırılır. Uygulama kimliği `com.akis.studio` (`src-tauri/tauri.conf.json`); mağazalara göndermeden önce kendi alan adınıza göre değiştirin.

## PostgreSQL (barındırılan)

Neon, Supabase, Railway gibi bir sağlayıcının bağlantı adresini `.env` içine yazın:

```sh
DATABASE_URL=postgresql://kullanici:parola@sunucu/veritabani?sslmode=require
```

`postgres://` ve `postgresql://` adresleri otomatik olarak psycopg sürücüsüne çevrilir. Tabloları oluşturmak için `python -m alembic -c backend/alembic.ini upgrade head` (başlatıcı bunu kendisi yapar). Docker Compose'da `DATABASE_URL` doluysa paketlenmiş postgres yerine bu adres kullanılır.

## Cloudinary

`.env` içine `CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME` ekleyin. Dosyalar önce sunucuda dönüştürülür (JPEG, H.264/AAC, TikTok videosu), sonra `akis/<şirket-id>/` altına yüklenir. İşleyici bir dosyanın yerel kopyasını bulamazsa Cloudinary'den indirir; böylece API ve worker ayrı makinelerde çalışabilir. `KEEP_LOCAL_MEDIA=false` yerel kopyaları yükleme sonrası siler. Kütüphaneden silinen medya Cloudinary'den de silinir. Not: Cloudinary adresleri bağlantıyı bilen herkes tarafından açılabilir; adresler tahmin edilemez kimlikler içerir.

## Yedekleme

Beat servisi her gün otomatik yedek alır (`BACKUP_DIR`, varsayılan `backups/`, son 14 yedek saklanır). Sistem yönetimi ekranından elle yedek alınıp geri yükleme kontrolü yapılabilir. Komut satırından:

```sh
python scripts/backup.py create           # yedek al ve doğrula
python scripts/backup.py verify DOSYA     # geçici veritabanına geri yükleyip kayıt sayılarını karşılaştır
python scripts/backup.py restore DOSYA URL  # boş ve şeması kurulmuş bir veritabanına geri yükle
```

Yedekler veritabanının tamamını içerir; erişim anahtarları şifreli kalır ve geri yüklemek için aynı `CREDENTIAL_KEY` gerekir. Medya dosyaları Cloudinary'de (veya `media` hacminde) ayrıca durur.

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

Her API isteği oturumdaki kullanıcıya ve seçili şirkete göre yetkilendirilir; başka şirketin içerik, medya veya bağlantısına erişim reddedilir. Sistem yöneticisi bir şirkete üye değilse o şirketin içeriğini göremez. TLS ve disk kotası işletmecinin kurulumuna bağlıdır.

## Geliştirme ve doğrulama

Aktif kod: `app/page.tsx`, `app/studio/`, `backend/akis/`, `backend/migrations/`, `src-tauri/` (uygulama kabuğu), `.github/workflows/apps.yml` (uygulama derlemeleri). Önceki Cloudflare sürümünün yerel klasörde kalan dosyaları yeni sunucu tarafından kullanılmaz; dağıtım kaynağı paketi yalnızca yeni uygulamayı içerir.

```sh
python -m pytest backend/tests -q
npm run build
python -m alembic -c backend/alembic.ini upgrade head
```

Python komutlarını bağımlılıkların kurulu olduğu sanal ortamda çalıştırın. Alembic için `PYTHONPATH=backend` gerekir; başlatıcı bunu ayarlar.

Doğrulama (0.3): 44 otomatik test geçti. Önceki 28 teste ek olarak şirket izolasyonu, roller, onay/red akışı, şirket saat dilimiyle zamanlama, işlem geçmişinde anahtar sızmaması, sistem panelinde anahtar görünmemesi, gönderim denemesi kaydı, medya kütüphanesi, iki aşamalı giriş, parola değişince eski oturumların kapanması, yedek alma/geri yükleme kontrolü ve Cloudinary yükleme/indirme akışı test edildi. Alembic geçişi eski 0.2 verisiyle denendi, modellerle şema farkı yok. Cloudinary bağlantısı gerçek hesapla doğrulandı. Gerçek sosyal medya hesaplarıyla canlı paylaşım yapılmadı; platform yanıtları testlerde taklit edildi.
