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

# Session cookie: expiry.user_id.session_version.nonce.signature
SESSION_SECONDS=43200
def make_user_session(user_id,version):
    payload=f'{int(time.time())+SESSION_SECONDS}.{user_id}.{version}.{secrets.token_urlsafe(18)}'
    return payload+'.'+sign(payload)
def read_session(value):
    """Return (user_id, session_version) for a valid cookie, else None."""
    try:
        payload,signature=value.rsplit('.',1)
        expires,user_id,version,_=payload.split('.',3)
        if int(expires)>time.time() and hmac.compare_digest(signature,sign(payload)): return user_id,int(version)
    except (ValueError,AttributeError): pass
    return None

def verify_password(password,stored):
    if not stored or ':' not in stored: return False
    return hmac.compare_digest(password_hash(password,stored.split(':')[0]),stored)

# RFC 6238 TOTP (30s, 6 digits, SHA1) — compatible with Google Authenticator, 1Password, Authy.
def totp_secret(): return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')
def totp_code(secret,counter):
    key=base64.b32decode(secret+'='*(-len(secret)%8))
    digest=hmac.new(key,counter.to_bytes(8,'big'),hashlib.sha1).digest()
    offset=digest[-1]&15
    return str((int.from_bytes(digest[offset:offset+4],'big')&0x7fffffff)%1000000).zfill(6)
def totp_verify(secret,code,at=None):
    code=''.join(ch for ch in str(code or '') if ch.isdigit())
    if len(code)!=6 or not secret: return False
    counter=int((at or time.time())//30)
    return any(hmac.compare_digest(totp_code(secret,counter+d),code) for d in (-1,0,1))
