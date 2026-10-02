# Akış 0.3 — Güvenlik, performans ve QOL doğrulama raporu

Tarih: 2026-09-28 · Kapsam: `akis-dev` klasörü (son güvenlik/performans/QOL değişiklikleri) · Hazırlayan: Claude (Opus 5.5)

> Doğru ifade: **otomatik güvenlik regresyonları geçti; manuel/dinamik kontrollerin bir kısmı tamamlandı, bir kısmı ortam eksikliği nedeniyle NOT TESTED.** "Penetration test bitti" denmemeli.

## 0. Depo durumu (git)

| Kontrol | Sonuç |
|---|---|
| `git status` / branch / HEAD | **Yapılamadı.** `akis-dev` ve `akis-main` git deposu değil (`fatal: not a git repository`). Commit hash yok. |
| Referans nokta | Değişikliklerden önce alınan tam kopya: `C:\Users\yugan\akis-dev-snapshot` (diff'ler buna göre). |
| Commit/push | Kullanıcı onayıyla `https://github.com/MertLyzon/akis` deposunun `dev` dalına gönderildi. Commit hash'i için `git log -1 dev` (rapor aynı commit'in içinde olduğu için hash burada yazılamaz). |
| Gerçek veri | Neon/`.env` hiç okunmadı ve bağlanılmadı. Testler geçici SQLite ve geçici yerel PostgreSQL 16 (127.0.0.1:55432, trust, temp klasör) üzerinde. Gerçek sosyal medya hesabına istek atılmadı; platform yanıtları taklit edildi. |

## 1. Özet karar

**Merge edilebilir.** Otomatik güvenlik regresyonlarının tamamı geçiyor; bilinen P0/P1 açık kalmadı (P1-4 davet akışıyla kapatıldı). Üretime almadan önce şu iki kapının gerçek ortamda tamamlanması gerekiyor:

- **Docker/nginx (8)**: makinede Docker yok → NOT TESTED.
- **Tauri Windows build (9)**: MSVC C++ araçları yok → BLOCKED.

## 2. Kabul kapıları

| # | Kapı | Sonuç |
|---|---|---|
| 1 | Testler Python 3.12'de | **PASS** — 3.12.11: SQLite 149 passed + 1 skipped (PG'ye özel yarış testi); PostgreSQL 16: 150 passed. Başlangıçtaki 64 test de 3.12'de geçti. |
| 2 | TOTP paralel tekrar | **PASS** (önce FAIL idi: iki paralel istek de 200 dönüyordu) |
| 3 | OAuth eski oturum | **PASS** |
| 4 | Reverse proxy IP güven sınırı | **PASS (birim/ASGI)** · Docker üzerinde **NOT TESTED** |
| 5 | Şirketler arası IDOR | **PASS** — 4 rol × 2 şirket başlığı × 17 kaynak + şirket kapsamlı yollar |
| 6 | ETag şirketler arası sızıntı | **PASS** |
| 7 | SW API/özel veri cache'lemez | **PASS (Node simülasyonu)** · gerçek Chrome/Safari **NOT TESTED** |
| 8 | Docker/nginx gerçek ortam | **NOT TESTED** — makinede Docker yok |
| 9 | Windows Tauri build | **BLOCKED** — MSVC `link.exe` (VS "C++ ile masaüstü geliştirme") ve MinGW `dlltool` kurulu değil. Bu arada bulunan ve düzeltilen sürüm uyuşmazlığı: P2-5 |
| 10 | Ayrı branch'e push + hash | **PASS** — `MertLyzon/akis` → `dev` dalı |

## 3. Bulgular

### P0
Yok.

### P1

**P1-1 · Aynı TOTP kodu paralel isteklerle iki kez kabul ediliyordu** — FIXED
- Tekrar üretme: 2FA'lı hesapla, aynı parola+kodla iki eşzamanlı `POST /api/login` → ikisi de 200.
- Neden: sayaç okunup Python'da karşılaştırılıyor, sonra yazılıyordu (TOCTOU).
- Düzeltme: `claim_totp_step` koşullu UPDATE (`totp_last_counter IS NULL OR < step`), rowcount=1 olan kazanır — `backend/akis/main.py:130`; girişte ve 2FA kapatmada kullanılıyor.
- Regresyon: `test_security_matrix.py::test_same_totp_code_in_parallel_logs_in_once` (önce `[200,200]`, şimdi `[200,401]`).

**P1-2 · Planlı gönderi iptali ile worker yarışı: iptal 200 dönüp uçuştaki gönderimi siliyordu** — FIXED
- Tekrar üretme (PostgreSQL, gerçek satır kilidi): worker satırı `pending→sending` yapıp transaction'ı açık tutarken `POST /api/posts/{id}/cancel`. Eski kod: **200**, satır silinir, worker yine de yayımlar.
- Düzeltme: koşullu `DELETE … WHERE status='pending' AND retry_count=0`, silinen sayısı beklenenle eşleşmezse rollback + 400 — `backend/akis/main.py:614-622`.
- Regresyon: `test_cancel_racing_a_worker_claim_on_postgres` (eski kodla çalıştırıldı → FAIL `200==400`; yeni kodla PASS), `test_cancel_refuses_when_worker_already_claimed`.

**P1-3 · Hesap tespiti: kayıtlı olmayan e-postada parola hash'i hiç hesaplanmıyordu** — FIXED (önceki tur)
- Ölçüm (120'şer örnek, sınır sayaçları temizlenerek): medyan kayıtlı 148,6 ms / kayıtsız 148,4 ms; ortalama 151,7 / 150,1 ms. HTTP durumu ve gövde birebir aynı.
- Düzeltme: `verify_password` sahte hash ile eşdeğer maliyet — `backend/akis/security.py:62`, `main.py:142`.
- Regresyon: `test_auth_limits.py::test_unknown_and_known_email_cost_the_same`, `test_hardening.py::test_unknown_email_takes_the_same_path_as_wrong_password`.

**P1-4 · Şirket yöneticisi, başka şirketteki mevcut bir hesabı onayı olmadan ekleyebiliyor ve e-postanın kayıtlı olup olmadığını öğrenebiliyordu** — FIXED (davet akışı)
- Eski davranış: B yöneticisi `POST /api/company/members {"email":"a-editor@a.com"}` → kişi anında B'ye üye; cevap mevcut hesapta `temporary_password: null` (13 ms), yeni hesapta dolu (143 ms).
- Yeni akış:
  - `POST /api/company/members` artık hesaba hiç bakmıyor, kimseyi eklemiyor ve hesap açmıyor. Tek kullanımlık, 7 gün geçerli bir davet üretiyor. Cevap her e-posta için aynı biçimde (`invite_token`, `invite_path=/#davet=…`, `expires_at`). Ölçüm (30'ar örnek): medyan mevcut 20,4 ms / yeni 19,6 ms.
  - Veritabanında token'ın yalnızca SHA-256 hash'i tutuluyor. Token adresin `#` kısmında olduğu için sunucuya ya da erişim loglarına gitmiyor.
  - Kabul (`POST /api/invites/{token}/accept`): hesabı olan kişi kendi parolasıyla (ve 2FA koduyla) onay veriyor; hesabı olmayan kişi parolasını kendisi belirliyor (en az 10 karakter). Kabul, girişle aynı hız sınırlarından geçiyor. Tek kullanımlık olması koşullu UPDATE ile sağlanıyor. İşlem geçmişine `member.invited` / `member.joined` / `member.invite_revoked` yazılıyor; token ve parola yazılmıyor.
  - Yeniden davet eski bağlantıyı geçersiz kılıyor. Yönetici bekleyen davetleri görüp iptal edebiliyor. Başka şirketin davetine dokunulamıyor.
- Etkilenen: `backend/akis/admin.py` (`add_member`, `list_invites`, `revoke_invite`), `backend/akis/main.py` (`authenticate`, `invite_info`, `accept_invite`), `backend/akis/models.py` (`Invitation`), migration `e4a8d61b2c95_invitations.py`, `app/studio/Invite.tsx`, `app/studio/Team.tsx`, `app/page.tsx`.
- Kalan risk (bilinçli, belgelendi): Sistemde e-posta doğrulaması (SMTP) olmadığı için bağlantıyı elinde tutan kişi, kabul ekranında rastgele bir parola deneyerek hesabın var olup olmadığını dolaylı olarak öğrenebilir (mevcut hesapta 401, yeni hesapta hesap açılır). Bu deneme girişle aynı hız sınırına tabi ve işlem geçmişine yazılıyor. Sistem yöneticisinin şirket oluştururken kullandığı geçici parola akışı değişmedi. Tam çözüm için davet bağlantısının e-postayla gönderilmesi gerekir.
- Regresyon testleri (`test_security_matrix.py`): `test_invite_answer_is_identical_for_existing_and_new_emails`, `test_existing_account_joins_only_with_its_own_password`, `test_invitation_lifecycle`, `test_revoked_expired_and_reissued_invitations`, `test_invitation_of_other_company_cannot_be_revoked`, `test_accepting_needs_2fa_code_when_enabled`, `test_invite_acceptance_is_rate_limited`, `test_same_invitation_accepted_twice_in_parallel`. Tarayıcıda: davet oluşturma → bağlantı → yeni hesapla kabul → stüdyoya giriş; aynı bağlantı ikinci kez reddedildi.

### P2

| ID | Bulgu | Durum | Dosya | Regresyon testi |
|---|---|---|---|---|
| P2-1 | 49 MP'lik birkaç KB'lık PNG kabul ediliyordu (dekompresyon bombası, worker belleği) | FIXED — yüklemede piksel sınırı 40 MP | `main.py:390-395` | `test_decompression_bomb_is_refused` |
| P2-2 | Cloudinary indirmesi `http://` kabul ediyor ve yönlendirmeyi takip ediyordu (ör. `169.254.169.254`) | FIXED — yalnız `https` + `*.cloudinary.com`, kullanıcı bilgisi yok, `follow_redirects=False` | `storage.py:41,57` | `test_remote_media_fetch_refuses_foreign_hosts[*]` (9 URL), `test_remote_media_fetch_does_not_follow_redirects` |
| P2-3 | NUL karakteri: SQLite'ta `q=\x00` tüm medyayı eşliyordu; PostgreSQL bu karakteri reddettiği için 500 riski | FIXED — JSON gövdede `\u0000` ve adreste `%00` → 400; dosya adlarından kontrol karakterleri temizleniyor | `main.py:76-77`, `main.py:400` | `test_nul_characters_are_refused_everywhere`, `test_search_and_filters_are_inert[\x00]` (PG'de de geçti) |
| P2-4 | Otomatik taslak yalnızca şirkete göre saklanıyordu: ortak bilgisayarda sonraki kullanıcı öncekinin taslağını görüyordu; şirket değiştirmek taslağı siliyordu; mevcut gönderiyi düzenleyip kaydetmek yarım yeni taslağı siliyordu | FIXED — anahtar `kullanıcı:şirket`, çıkışta temizlik, düzenleme saklanan taslağa dokunmuyor, şirket değişiminde saklanıyor | `app/page.tsx:30-44` | Tarayıcıda manuel (bölüm 5) |
| P2-5 | `Cargo.lock` yok, `tauri = "2"`: temiz her derleme tauri 2.12 çekiyor, npm `@tauri-apps/api` 2.11 → `tauri build` sürüm uyuşmazlığıyla duruyor (CI "Uygulamalar" iş akışı da etkilenir) | FIXED — `tauri ~2.11`, `tauri-plugin-opener ~2.5`, `Cargo.lock` oluşturuldu (depoya eklenmeli) | `src-tauri/Cargo.toml:17-18` | Derleme uyuşmazlık kontrolünü geçti; tam build BLOCKED (kapı 9) |
| P2-6 | Vite 8.0.13 (dev): Windows'ta `server.fs.deny` atlatması ve launch-editor NTLM hash sızıntısı (GHSA-fx2h-pf6j-xcff, GHSA-v6wh-96g9-6wx3). Dev sunucu Windows'ta kullanılıyor | FIXED — `vite 8.3.1` | `package.json` | `npm audit` → 0 |
| P2-7 | Docker'da `--forwarded-allow-ips "*"` (önceki turdaki ayar): API portu doğrudan açılırsa X-Forwarded-For ile rate limit atlatılabilirdi | FIXED — yalnız sabitlenmiş nginx IP'si (`172.29.53.10`) güvenilir; nginx istemcinin XFF'ini eziyor | `backend/Dockerfile:11-14`, `compose.yaml:20,79,87`, `deploy/nginx.conf` | `test_auth_limits.py` (4 test) |

### P3

| ID | Bulgu | Durum |
|---|---|---|
| P3-1 | TOTP'de harf içeren kodlar (`309x848`) rakamlar ayıklanarak kabul ediliyordu | FIXED — yalnız rakam; boşluk/tire kabul (`security.py:74`) · `test_totp_window_and_format` |
| P3-2 | Bozuk/eksik yedek dosyası doğrulamada 500 + traceback | FIXED — 400 (`admin.py:212`) · `test_backup_tampering_and_names` |
| P3-3 | Gzip, BaseHTTPMiddleware'in dışında kaldığı için `minimum_size`'ı yok sayıyordu (26 baytlık cevaplar da sıkıştırılıyor, Content-Length düşüyordu) | FIXED — gzip guards'ın içine alındı (`main.py:68`) · `test_small_responses_are_not_gzipped` |
| P3-4 | Açık temada ikincil metinler ve bazı durum rozetleri WCAG AA altında (2.77–3.56) | FIXED — açık tema min. 4.52, koyu tema min. 7.03 (`globals.css`, `studio.css`, `theme-dark.css`) |
| P3-5 | Gizli dosya girdisi fazladan Tab durağı oluşturuyordu | FIXED (`MediaUpload.tsx`) |
| P3-6 | "Kopyala" kaydedilmemiş taslağı sessizce eziyordu | FIXED — onay sorusu |
| P3-7 | Çoklu yüklemede hata/başarı bildirimleri hangi dosyaya ait olduğunu söylemiyordu | FIXED — dosya adıyla |
| P3-8 | Yerel kipte süresi dolan/devre dışı kullanıcının oturumu sistem yöneticisi otomatik girişine düşüyor | OPEN — tasarım gereği (yalnız loopback); dokümante edildi |
| P3-9 | Şirket başına depolama kotası yok (editör diski doldurabilir) | OPEN — kaynak tüketimi riski; DoS testi yapılmadı |
| P3-10 | `/api/state` 304 yalnız bant genişliğini azaltıyor; sunucu yine tüm durumu hesaplıyor (~190 ms / 300 gönderi) | OPEN — iyileştirme önerisi: sürüm sayacı ile kısa devre |
| P3-11 | Rust bağımlılıkları: `glib 0.18.5` (RUSTSEC-2024-0429, yalnız Linux), `proc-macro-error` bakımsız (RUSTSEC-2024-0370) | OPEN — Tauri'nin dolaylı bağımlılığı |
| P3-12 | Üretimde varsayılan `APP_CLIENT_ORIGINS` içinde `http://localhost:1420` (Tauri dev) var | OPEN — üretimde env ile çıkarılması önerilir |

## 4. 22 maddenin durumu

Otomatik = pytest/betik; Manuel = tarayıcı/ortam.

| # | Başlık | Otomatik | Manuel | Not |
|---|---|---|---|---|
| 1 | Kimlik doğrulama, hesap tespiti | PASS | — | 120 örnek; 5 IP+hesap, 20 hesap geneli; başarı sayaçları temizliyor |
| 2 | Reverse proxy, IP sahteciliği | PASS | NOT TESTED (Docker yok) | uvicorn ProxyHeadersMiddleware ile güvenilen/güvenilmeyen eş, 25 sahte XFF dağıtık deneme |
| 3 | 2FA | PASS | — | tekrar, paralel, ±1 pencere, biçimler, etkinleştirme kodu, kapatma |
| 4 | Oturum güvenliği | PASS | — | parola değişince çerez+bearer iptali, "diğer cihazlar", devre dışı kullanıcı, çerez bayrakları, token yankılanmıyor. Log: uvicorn `--no-access-log`, nginx `/api` access_log kapalı (statik kontrol) |
| 5 | OAuth | PASS | — | tek kullanım, süre, başka kullanıcı, eski oturum, redirect URI, PKCE verifier, 200 içinde hata (3 varyant), çıktıda token/code/secret yok |
| 6 | Şirket izolasyonu | PASS | — | Sistem yöneticisi (üyesiz şirkete 403) + B'nin 4 rolü; GET/POST/PATCH/PUT/DELETE |
| 7 | Kullanıcı ekleme | PASS | PASS | P1-4 davet akışıyla kapatıldı; kalan dolaylı tespit riski belgelendi |
| 8 | CSRF, CORS, origin | PASS | — | tüm yazma uçları × eksik/null/sahte/benzer origin → 403; CORS credentials yok; GET'ler durum değiştirmiyor (yerel kip otomatik girişi ve OAuth callback tasarım gereği hariç) |
| 9 | Dosya yükleme | PASS | — | sahte MIME (HTML/SVG/PHP/bozuk), path traversal, boş/sınır/aşım, bomba, bozuk video, yarım yükleme, eşzamanlı aynı dosya. Çoklu yükleme kısmi hata: arayüzde dosya adıyla (manuel kod incelemesi) |
| 10 | Cloudinary / dış kaynak | PASS | PASS (CSP altında demo görsel yüklendi) | KEEP_LOCAL_MEDIA true/false ayrı test |
| 11 | SQL, XSS, doğrulama | PASS | PASS | Stored XSS: içerik, şirket adı, üye adı, dosya adı, klasör, etiket — 5 ekranda metin olarak görünüyor, çalışmıyor |
| 12 | Güvenlik başlıkları | PASS (FastAPI) | PASS (tarayıcı CSP, Cloudinary + imzalı medya) · nginx NOT TESTED | HSTS yalnız HTTPS origin'de |
| 13 | ETag / 304 | PASS | PASS (304 sonrası ekran korunuyor, başlık güncelleniyor) | ETag kullanıcı+şirkete bağlı; 304 gövdesiz, `no-store` |
| 14 | Kuyruk, idempotency | PASS | — | paralel requestId, 4 paralel worker → tek yayın, bekleme tek attempt, tekrar sayısı, kesin hata, çökme kurtarma, iptal yarışı (PG) |
| 15 | Audit | PASS | — | kritik işlemler kayıtlı, secret yok, 150 aynı saniye kaydı atlanmadan/tekrarsız, şirketler arası 403, değiştirme/silme ucu yok |
| 16 | Yedekleme | PASS | — | oluştur+doğrula, traversal, bozuk/eksik/değiştirilmiş, yanlış anahtar güvenli hata, tokenlar şifreli, legacy import şifreliyor, web kökünden erişilemez |
| 17 | Migration (PostgreSQL 16) | PASS | — | boş DB: upgrade/check/downgrade/upgrade/check; 2000 satırlı eski revizyon yükseltmesi veri kaybetmedi; 7 indeks var, 4 gereksiz indeks yok; plan `ix_contents_company_created` kullanıyor |
| 18 | Performans | PASS | — | tablo aşağıda |
| 19 | QOL | — | PASS (P2-4, P3-4..7 düzeltmeleriyle) | taslak izolasyonu, çıkış, düzenleme, Kopyala yeni ID, sekme başlığı, 280/2200, klavye, kontrast |
| 20 | SW / PWA | PASS (simülasyon) | NOT TESTED | Claude in Chrome bağlı değildi; gömülü panel SW kaydına izin vermiyor. Safari test edilmedi |
| 21 | Docker ve Windows | kısmi | kısmi | `Baslat.ps1` temiz kopyada PASS (API+Vite ayağa kalktı); Python 3.12 PASS; `npm ci`/`npm run build` PASS; masaüstü sunucu adresi kontrolü PASS (http uzak ret, https+localhost kabul); Docker NOT TESTED; Tauri build BLOCKED |
| 22 | Bağımlılıklar | PASS | — | pip-audit 0; npm audit (prod) 0; tam npm audit 0 (Vite yükseltmesi sonrası); cargo audit kurulamadı → OSV/RustSec sorgusu (470 crate): P3-11; secret taraması (detect-secrets) 0; git geçmişi yok (NOT TESTED); `.gitignore` `.env`, `.local-admin-password`, `data/`, `backups/`, `work/`, `dist/` kapsıyor |

### Performans (PostgreSQL 16, 200 medya, gönderi başına 2 kanal × 2 deneme)

| Gönderi | Sorgu/istek | Medyan | p95 | JSON | 304 süresi |
|---|---|---|---|---|---|
| 10 | 11 | 63 ms | 69 ms | 91 KB | 68 ms |
| 100 | 11 | 105 ms | 231 ms | 228 KB | 100 ms |
| 1.000 | 11 | 180 ms | 328 ms | 540 KB | 189 ms |
| 10.000 | 11 | 191 ms | 384 ms | 546 KB | 216 ms |

Sorgu sayısı sabit (N+1 yok); O(n²) eşleme kalmadı (liste 300 gönderiyle sınırlı olduğu için 1.000 → 10.000 düz). Gzip: 27 KB state → 1,7 KB; 26 baytlık cevap sıkıştırılmıyor. İmzalı medya adresi gün içinde sabit, 1–2 gün sonra doluyor.

## 5. Tarayıcıda yapılan manuel kontroller (gömülü tarayıcı, derlenmiş arayüz FastAPI üzerinden, geçici SQLite)

- Stored XSS: 6 alan × 5 ekran → `window.__xss` tanımsız, `<img src=x>` / `<script>` / `svg[onload]` DOM'da yok.
- CSP altında Cloudinary görseli (864 px) ve yerel imzalı görsel yüklendi; CSP ihlali konsolda yok.
- Taslak: A şirketinde yaz → B'ye geç (boş) → A'ya dön (geri geldi); düzenleme sonrası yarım taslak korundu; çıkışta `akis-draft:*` = 0.
- Kopyala: yeni ID, asıl gönderi değişmedi. Sekme başlığı onay bekleyince `(1) Akış…`.
- Klavye: tüm menü, kanal seçimi, metin, yükleme, zamanlama, kaydet/gönder Tab ile erişilebilir.
- Kontrast: açık min. 4.52, koyu min. 7.03.

## 6. Çalıştırılan başlıca komutlar

```
python -m pytest -q                                  # 3.14 SQLite: 149 passed, 1 skipped
v312\Scripts\python -m pytest -q                     # 3.12 SQLite: 149 passed, 1 skipped
AKIS_TEST_DATABASE_URL=postgresql+psycopg://…/akis_tests v312\Scripts\python -m pytest -q   # 3.12 PG16: 150 passed
python -m alembic -c backend/alembic.ini upgrade head | check | downgrade -1   # PG16 ve SQLite
npx tsc --noEmit ; npm run build                     # temiz
npm audit --omit=dev ; npm audit ; pip-audit -r backend/requirements.txt   # 0 / 0 / 0
detect-secrets scan                                  # 0
diff --check eşdeğeri (snapshot'a göre)              # 31 dosya, 0 sorun
powershell -File Baslat.ps1  (temiz kopya)           # API 200, Vite 200
npm run app:build                                    # BLOCKED: link.exe yok
```

`git diff --check` depo olmadığı için snapshot'a karşı eşdeğer betikle yapıldı (satır sonu boşluğu, çakışma işareti, karışık satır sonu).

## 7. NOT TESTED / BLOCKED listesi (gizlenmeden)

1. Docker compose up --build, nginx başlıkları/gzip/upload streaming/büyük dosya, gerçek istemci IP'si — Docker yok.
2. Tauri Windows build — MSVC C++ araçları (link.exe) yok. Visual Studio Installer'da "C++ ile masaüstü geliştirme" eklenince `npm run app:build` (vcvars64 ortamında) tekrar denenmeli.
3. Gerçek Chrome ve Safari'de PWA kurulumu / SW kaydı / çevrimdışı — Claude in Chrome bağlı değildi.
4. Git geçmişi secret taraması — depo bu turda ilk kez oluşturuldu, önceki geçmiş yok. Tracked dosyalar push öncesi kontrol edildi (`.env`, yedek, SQLite, medya yok).
5. Temiz (başka) bir Windows makinesi — aynı makinede temiz kopya ile yapıldı.
6. Gerçek platform hesaplarıyla canlı paylaşım — kural gereği yapılmadı.

## 8. Değişen dosyalar (bu tur)

Backend: `akis/main.py` (davet kabulü dahil), `akis/security.py`, `akis/storage.py`, `akis/admin.py`, `akis/oauth.py`, `akis/jobs.py`, `akis/media.py`, `akis/models.py`, `akis/db.py`, `migrations/versions/c7d2a91e5f30_indexes_totp_replay.py`, `migrations/versions/e4a8d61b2c95_invitations.py`.
Testler: `tests/conftest.py` (AKIS_TEST_DATABASE_URL), `tests/test_companies.py`, yeni `tests/test_hardening.py`, `tests/test_security_matrix.py`, `tests/test_auth_limits.py`.
Frontend: `app/page.tsx`, yeni `app/studio/Invite.tsx`, `app/studio/{api.ts,Posts.tsx,Library.tsx,MediaUpload.tsx,Account.tsx,Team.tsx,studio.css,theme-dark.css}`, `app/globals.css`, `public/sw.js`.
Dağıtım: `backend/Dockerfile`, `compose.yaml`, `deploy/nginx.conf`, `package.json`/`package-lock.json` (vite 8.3.1), `src-tauri/Cargo.toml`, yeni `src-tauri/Cargo.lock`.
