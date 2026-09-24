"""Create local secrets without overwriting existing keys or data."""
import base64,hashlib,secrets
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env=root/'.env'
if not env.exists():
    key=''
    legacy=root/'.dev.vars'
    if legacy.exists():
        for line in legacy.read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('CREDENTIAL_KEY='): key=line.split('=',1)[1].strip().strip('"')
    key=key or base64.b64encode(secrets.token_bytes(32)).decode()
    password=secrets.token_urlsafe(18);salt=secrets.token_hex(16)
    digest=hashlib.scrypt(password.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
    env.write_text(f'CREDENTIAL_KEY={key}\nADMIN_PASSWORD_HASH={salt}:{digest}\nADMIN_EMAIL=admin@akis.local\nPOSTGRES_PASSWORD={secrets.token_urlsafe(24)}\nDATABASE_URL=\nCLOUDINARY_URL=\n',encoding='utf-8')
    (root/'.local-admin-password').write_text(password,encoding='utf-8')
    print('Local secrets created. Initial server login password: .local-admin-password')
else: print('Existing .env preserved.')
(root/'data'/'media').mkdir(parents=True,exist_ok=True)
