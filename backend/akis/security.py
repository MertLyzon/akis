import base64, hashlib, hmac, secrets, time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .config import settings

def raw_key():
    key = base64.b64decode(settings.credential_key)
    if len(key) != 32: raise RuntimeError('CREDENTIAL_KEY must contain 32 random bytes as base64')
    return key

def encrypt(value):
    if not value: return None
    iv=secrets.token_bytes(12)
    return base64.b64encode(iv).decode()+'.'+base64.b64encode(AESGCM(raw_key()).encrypt(iv,value.encode(),None)).decode()

def decrypt(value):
    if not value: return ''
    iv,data=value.split('.')
    return AESGCM(raw_key()).decrypt(base64.b64decode(iv),base64.b64decode(data),None).decode()

def sign(value): return hmac.new(raw_key(),value.encode(),hashlib.sha256).hexdigest()
def make_session():
    payload=f'{int(time.time())+43200}.{secrets.token_urlsafe(24)}'
    return payload+'.'+sign(payload)
def valid_session(value):
    try:
        payload,signature=value.rsplit('.',1)
        return int(payload.split('.')[0])>time.time() and hmac.compare_digest(signature,sign(payload))
    except (ValueError,AttributeError): return False

def password_hash(password, salt=None):
    salt=salt or secrets.token_hex(16)
    result=hashlib.scrypt(password.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
    return salt+':'+result
def check_password(password):
    if not settings.admin_password_hash: return False
    salt=settings.admin_password_hash.split(':')[0]
    return hmac.compare_digest(password_hash(password,salt),settings.admin_password_hash)
