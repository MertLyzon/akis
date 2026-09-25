MESSAGES = {
 ('instagram','36001'): 'Instagram görsel biçimini kabul etmedi. JPEG ve kare, 4:5 dikey veya 1.91:1 yatay oran kullan. Medyayı yeniden yükleyerek otomatik düzenlemeyi çalıştır.',
 ('instagram','36003'): 'Instagram medya boyutunu veya en-boy oranını kabul etmedi. Medyayı yeniden yükle; Akış görseli uygun boyuta getirir.',
 ('whatsapp','132001'): 'Şablon adı veya dil kodu bulunamadı. Onaylı şablonun adını ve dilini kontrol et (örneğin en_US).',
 ('whatsapp','131030'): 'Bu telefon numarası WhatsApp test alıcı listesinde değil. Meta panelinde test alıcısı olarak ekle.',
 ('whatsapp','131047'): '24 saatlik müşteri hizmetleri penceresi kapalı. Onaylı şablon mesajı kullan.',
 ('whatsapp','132012'): 'Şablondaki medya türü veya parametreler uyuşmuyor. Onaylı şablon başlığı ile görsel/video türünü ve parametrelerini eşleştir.',
 ('whatsapp','131053'): 'WhatsApp medya yüklemesini kabul etmedi. Dosya türünü ve boyutunu kontrol et.',
 ('tiktok','url_ownership_unverified'): 'Medya adresinin alan adı TikTok’ta doğrulanmamış. Dosyadan aktarım yöntemini kullan veya alan adını TikTok geliştirici panelinde doğrula.',
 ('tiktok','v_inbox_url'): 'TikTok video bekliyor. Görseli Akış’a dosya olarak yükle; kısa bir videoya otomatik dönüştürülecek.',
 ('tiktok','scope_not_authorized'): 'TikTok video.upload izni verilmemiş. Hesabı yeniden bağlayıp video yükleme iznini onayla.',
 ('tiktok','spam_risk_too_many_pending_share'): 'TikTok’ta tamamlanmayı bekleyen çok fazla paylaşım var. Gelen kutundaki paylaşımları tamamladıktan sonra tekrar dene.',
 ('x','403'): 'X paylaşım izni eksik veya API planı bu işlemi desteklemiyor. tweet.write ve media.write izinlerini kontrol edip hesabı yeniden bağla.',
}
class PlatformError(Exception):
    def __init__(self,platform,code,message=None,retryable=False,ambiguous=False,reason=''):
        self.platform,self.code=str(platform),str(code)
        self.retryable,self.ambiguous=retryable,ambiguous
        self.reason=reason
        self.message=message or MESSAGES.get((self.platform,self.code)) or generic(self.code)
        super().__init__(self.message)
def generic(code):
    if str(code) in ('190','401','access_token_invalid','invalid_grant','invalid_token'): return 'Hesabın erişim süresi dolmuş veya izin kaldırılmış. Bağlantılar ekranından hesabı yeniden bağla.'
    if str(code) in ('429','rate_limit_exceeded','4','17','32','613'): return 'Platformun işlem sınırına ulaşıldı. Akış kısa bir süre bekleyip yeniden deneyecek.'
    if str(code) in ('network','500','502','503','504','temporarily_unavailable'): return 'Platform geçici olarak yanıt vermiyor. Güvenli olan işlemler otomatik yeniden denenecek.'
    return 'Platform bu işlemi kabul etmedi. Hesap izinlerini ve içerik koşullarını kontrol et. Ayrıntı kodu aşağıda gösteriliyor.'
