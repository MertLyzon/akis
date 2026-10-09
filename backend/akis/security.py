import base64, hashlib, hmac, secrets, time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .config import settings

_keys={}
def raw_key():
    # Decoded once per configured value; state serialization signs every media URL.
    cached=_keys.get(settings.credential_key)
    if cached: return cached[0]
    key = base64.b64decode(settings.credential_key)
    if len(key) != 32: raise RuntimeError('CREDENTIAL_KEY must contain 32 random bytes as base64')
    _keys.clear();_keys[settings.credential_key]=(key,AESGCM(key))
    return key
def _cipher():
    raw_key();return _keys[settings.credential_key][1]

def encrypt(value):
    if not value: return None
    iv=secrets.token_bytes(12)
    return base64.b64encode(iv).decode()+'.'+base64.b64encode(_cipher().encrypt(iv,value.encode(),None)).decode()

def decrypt(value):
    if not value: return ''
    iv,data=value.split('.')
    return _cipher().decrypt(base64.b64decode(iv),base64.b64decode(data),None).decode()

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

# Hashed when the account does not exist, so response time does not reveal which e-mails are registered.
_DUMMY_HASH=password_hash(secrets.token_urlsafe(16))
def verify_password(password,stored):
    if not stored or ':' not in stored:
        hmac.compare_digest(password_hash(password,_DUMMY_HASH.split(':')[0]),_DUMMY_HASH);return False
    return hmac.compare_digest(password_hash(password,stored.split(':')[0]),stored)

# RFC 6238 TOTP (30s, 6 digits, SHA1) — compatible with Google Authenticator, 1Password, Authy.
def totp_secret(): return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')
def totp_code(secret,counter):
    key=base64.b32decode(secret+'='*(-len(secret)%8))
    digest=hmac.new(key,counter.to_bytes(8,'big'),hashlib.sha1).digest()
    offset=digest[-1]&15
    return str((int.from_bytes(digest[offset:offset+4],'big')&0x7fffffff)%1000000).zfill(6)
def totp_match(secret,code,at=None,after=None):
    """Return the time step the code belongs to, or None. Steps at or before `after` are refused (replay)."""
    code=str(code or '').replace(' ','').replace('-','')
    if len(code)!=6 or not code.isascii() or not code.isdigit() or not secret: return None
    counter=int((at or time.time())//30)
    for step in (counter-1,counter,counter+1):
        if after is not None and step<=after: continue
        if hmac.compare_digest(totp_code(secret,step),code): return step
    return None
def totp_verify(secret,code,at=None): return totp_match(secret,code,at) is not None
