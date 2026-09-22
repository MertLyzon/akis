"""Users, company membership, role permissions and the audit trail."""
import secrets
from dataclasses import dataclass
from fastapi import Request, HTTPException
from sqlalchemy import select
from .config import settings
from .db import Session
from .models import User, Company, Membership, AuditLog, now
from .security import read_session, password_hash

PERMISSIONS={
    'viewer':{'read'},
    'editor':{'read','compose','media'},
    'approver':{'read','compose','media','approve'},
    'admin':{'read','compose','media','approve','connections','settings','members','audit'},
}
ROLE_NAMES={'admin':'Şirket yöneticisi','approver':'Onaylayan','editor':'Editör','viewer':'Görüntüleyen'}
COMPANY_HEADER='x-akis-company'

@dataclass
class Actor:
    user_id:str
    email:str
    is_system_admin:bool
    company_id:str|None=None
    role:str|None=None
    def can(self,permission): return bool(self.role) and permission in PERMISSIONS[self.role]

def session_token(req):
    """Browser: httpOnly cookie. Native apps: Authorization: Bearer <same signed session>."""
    auth=req.headers.get('authorization','')
    if auth.lower().startswith('bearer '): return auth[7:].strip()
    return req.cookies.get('akis_session','')

def session_user(db,req):
    parsed=read_session(session_token(req))
    if not parsed: return None
    user=db.get(User,parsed[0])
    if not user or user.disabled or user.session_version!=parsed[1]: return None
    return user

def current_user(req:Request):
    with Session() as db:
        user=session_user(db,req)
        if not user: raise HTTPException(401,'Devam etmek için oturum aç.')
        return Actor(user.id,user.email,user.is_system_admin)

def resolve_company(db,user_id,req):
    """Pick the company from the request header; fall back to the user's first membership."""
    wanted=req.headers.get(COMPANY_HEADER,'')
    query=select(Membership,Company).join(Company,Company.id==Membership.company_id).where(Membership.user_id==user_id,Company.disabled==False)
    if wanted: query=query.where(Membership.company_id==wanted)
    row=db.execute(query.order_by(Membership.created_at)).first()
    if not row: raise HTTPException(403,'Bu şirket çalışma alanına erişimin yok.')
    return row[0]

def require(permission):
    def dependency(req:Request)->Actor:
        with Session() as db:
            user=session_user(db,req)
            if not user: raise HTTPException(401,'Devam etmek için oturum aç.')
            # The admin who created a temporary password knows it; nothing works until the user replaces it.
            if user.must_change_password: raise HTTPException(403,{'error':'Devam etmeden önce Hesabım ekranından kendi parolanı belirle.','must_change_password':True})
            m=resolve_company(db,user.id,req)
            actor=Actor(user.id,user.email,user.is_system_admin,m.company_id,m.role)
        if not actor.can(permission): raise HTTPException(403,'Bu işlem için yetkin yok. Şirket yöneticinle görüş.')
        return actor
    return dependency

def system_admin(req:Request)->Actor:
    actor=current_user(req)
    if not actor.is_system_admin: raise HTTPException(403,'Bu ekran yalnızca sistem yöneticileri içindir.')
    return actor

def audit(db,actor,action,target_type='',target_id='',company_id=None,**details):
    """Record who did what. Never pass tokens, secrets or passwords in details."""
    db.add(AuditLog(company_id=company_id if company_id is not None else getattr(actor,'company_id',None),user_id=getattr(actor,'user_id',None),user_email=getattr(actor,'email',''),action=action,target_type=target_type,target_id=str(target_id or ''),details=details))

def ensure_bootstrap():
    """First run: create the system admin (from ADMIN_EMAIL / ADMIN_PASSWORD_HASH) and a first company."""
    with Session() as db:
        if db.scalar(select(User.id).limit(1)): return
        company=db.scalar(select(Company).order_by(Company.created_at).limit(1))
        if not company:
            company=Company(name='Şirketim');db.add(company);db.flush()
        # Local mode without a configured hash gets an unguessable password; the session is automatic there.
        hashed=settings.admin_password_hash or password_hash(secrets.token_urlsafe(24))
        user=User(email=settings.admin_email.lower(),name='Sistem yöneticisi',password_hash=hashed,is_system_admin=True)
        db.add(user);db.flush()
        db.add(Membership(company_id=company.id,user_id=user.id,role='admin'))
        audit(db,None,'system.bootstrap','user',user.id,company_id=company.id)
        db.commit()

def first_system_admin(db):
    return db.scalar(select(User).where(User.is_system_admin==True,User.disabled==False).order_by(User.created_at).limit(1))

def memberships_json(db,user_id):
    rows=db.execute(select(Membership,Company).join(Company,Company.id==Membership.company_id).where(Membership.user_id==user_id,Company.disabled==False).order_by(Company.name))
    return [{'id':c.id,'name':c.name,'role':m.role,'role_name':ROLE_NAMES[m.role],'timezone':c.timezone,'permissions':sorted(PERMISSIONS[m.role])} for m,c in rows]
