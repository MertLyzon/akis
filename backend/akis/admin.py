"""Company admin (own team, usage, audit) and system admin (companies, queue, health) endpoints.

System admins see operational metadata only. Nothing here reads or returns access tokens,
refresh tokens or OAuth client secrets.
"""
import re, secrets
from zoneinfo import ZoneInfo, available_timezones
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import select, func
from .config import settings
from .db import Session, engine
from .models import Company, User, Membership, AuditLog, Content, ContentPlatform, MediaAsset, Credential, DeliveryAttempt, now
from .security import password_hash
from .access import require, system_admin, audit, ROLE_NAMES
from . import storage

router=APIRouter()
Role=Literal['admin','approver','editor','viewer']
EMAIL=re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

def temp_password(): return secrets.token_urlsafe(12)

def usage(db,company_id):
    storage_bytes=db.scalar(select(func.coalesce(func.sum(MediaAsset.size),0)).where(MediaAsset.company_id==company_id)) or 0
    since=now()-30*86400
    sent=db.scalar(select(func.count()).select_from(ContentPlatform).join(Content,Content.id==ContentPlatform.content_id).where(Content.company_id==company_id,ContentPlatform.status.in_(('sent','submitted')),ContentPlatform.sent_at>=since)) or 0
    return {'storage_bytes':int(storage_bytes),'media_count':db.scalar(select(func.count()).select_from(MediaAsset).where(MediaAsset.company_id==company_id,MediaAsset.variant=='source')) or 0,
        'content_count':db.scalar(select(func.count()).select_from(Content).where(Content.company_id==company_id)) or 0,'deliveries_30d':sent,
        'pending_approval':db.scalar(select(func.count()).select_from(Content).where(Content.company_id==company_id,Content.status=='pending_approval')) or 0,
        'connections':sorted(db.scalars(select(Credential.platform).where(Credential.company_id==company_id)))}

def find_or_create_user(db,email,name):
    """Returns (user, temporary_password or None). Existing users keep their password."""
    email=email.strip().lower()
    if not EMAIL.match(email): raise HTTPException(400,'Geçerli bir e-posta adresi gir.')
    user=db.scalar(select(User).where(User.email==email))
    if user: return user,None
    password=temp_password()
    user=User(email=email,name=name.strip(),password_hash=password_hash(password),must_change_password=True);db.add(user);db.flush()
    return user,password

# ---------- Company admin ----------

@router.get('/api/company')
def company_overview(actor=Depends(require('members'))):
    with Session() as db:
        c=db.get(Company,actor.company_id)
        members=[{'user_id':u.id,'email':u.email,'name':u.name,'role':m.role,'role_name':ROLE_NAMES[m.role],'totp_enabled':u.totp_enabled,'must_change_password':u.must_change_password,'disabled':u.disabled,'since':m.created_at}
            for m,u in db.execute(select(Membership,User).join(User,User.id==Membership.user_id).where(Membership.company_id==c.id).order_by(User.email))]
        return {'company':{'id':c.id,'name':c.name,'timezone':c.timezone,'require_approval':c.require_approval},'members':members,'usage':usage(db,c.id),'roles':ROLE_NAMES}

class CompanyEdit(BaseModel):
    name:str|None=Field(default=None,min_length=1,max_length=120)
    timezone:str|None=Field(default=None,max_length=64)
    require_approval:bool|None=None

@router.patch('/api/company')
def edit_company(data:CompanyEdit,actor=Depends(require('settings'))):
    with Session() as db:
        c=db.get(Company,actor.company_id);changes={}
        if data.timezone is not None:
            if data.timezone not in available_timezones(): raise HTTPException(400,'Geçerli bir saat dilimi seç (örn. Europe/Istanbul).')
            c.timezone=changes['timezone']=data.timezone
        if data.name is not None: c.name=changes['name']=data.name.strip()
        if data.require_approval is not None: c.require_approval=changes['require_approval']=data.require_approval
        audit(db,actor,'company.updated','company',c.id,**changes);db.commit()
    return {'ok':True}

class MemberInput(BaseModel):
    email:str=Field(max_length=254)
    name:str=Field(default='',max_length=120)
    role:Role='editor'

@router.post('/api/company/members')
def add_member(data:MemberInput,actor=Depends(require('members'))):
    with Session() as db:
        user,password=find_or_create_user(db,data.email,data.name)
        if db.scalar(select(Membership).where(Membership.company_id==actor.company_id,Membership.user_id==user.id)): raise HTTPException(400,'Bu kişi zaten ekipte.')
        db.add(Membership(company_id=actor.company_id,user_id=user.id,role=data.role))
        audit(db,actor,'member.added','user',user.id,email=user.email,role=data.role,new_account=bool(password));db.commit()
    # The temporary password is shown once to the admin and never stored in plain text.
    return {'ok':True,'email':user.email,'temporary_password':password}

class RoleInput(BaseModel): role:Role

def last_admin_guard(db,company_id,user_id):
    admins=db.scalar(select(func.count()).select_from(Membership).where(Membership.company_id==company_id,Membership.role=='admin',Membership.user_id!=user_id))
    if not admins: raise HTTPException(400,'Şirkette en az bir yönetici kalmalı.')

@router.patch('/api/company/members/{user_id}')
def change_role(user_id:str,data:RoleInput,actor=Depends(require('members'))):
    with Session() as db:
        m=db.scalar(select(Membership).where(Membership.company_id==actor.company_id,Membership.user_id==user_id))
        if not m: raise HTTPException(404,'Üye bulunamadı.')
        if m.role=='admin' and data.role!='admin': last_admin_guard(db,actor.company_id,user_id)
        old=m.role;m.role=data.role
        audit(db,actor,'member.role_changed','user',user_id,old=old,new=data.role);db.commit()
    return {'ok':True}

@router.delete('/api/company/members/{user_id}')
def remove_member(user_id:str,actor=Depends(require('members'))):
    with Session() as db:
        m=db.scalar(select(Membership).where(Membership.company_id==actor.company_id,Membership.user_id==user_id))
        if not m: raise HTTPException(404,'Üye bulunamadı.')
        if m.role=='admin': last_admin_guard(db,actor.company_id,user_id)
        db.delete(m);audit(db,actor,'member.removed','user',user_id);db.commit()
    return {'ok':True}

@router.post('/api/company/members/{user_id}/reset-password')
def reset_password(user_id:str,actor=Depends(require('members'))):
    with Session() as db:
        if not db.scalar(select(Membership).where(Membership.company_id==actor.company_id,Membership.user_id==user_id)): raise HTTPException(404,'Üye bulunamadı.')
        user=db.get(User,user_id)
        if user.is_system_admin: raise HTTPException(403,'Sistem yöneticisinin parolası buradan sıfırlanamaz.')
        # Another company's admin must not be able to take over a shared account.
        if db.scalar(select(func.count()).select_from(Membership).where(Membership.user_id==user_id,Membership.company_id!=actor.company_id)): raise HTTPException(403,'Bu kişi başka şirketlerde de üye; parolasını kendisi değiştirmeli.')
        password=temp_password();user.password_hash=password_hash(password);user.must_change_password=True;user.session_version+=1
        user.totp_enabled=False;user.totp_secret=None
        audit(db,actor,'member.password_reset','user',user_id);db.commit()
    return {'ok':True,'temporary_password':password}

@router.get('/api/audit')
def audit_log(before:int=0,action:str='',limit:int=100,actor=Depends(require('audit'))):
    with Session() as db:
        q=select(AuditLog).where(AuditLog.company_id==actor.company_id)
        if before: q=q.where(AuditLog.created_at<before)
        if action: q=q.where(AuditLog.action.startswith(action))
        rows=list(db.scalars(q.order_by(AuditLog.created_at.desc()).limit(min(max(limit,1),200))))
        return {'items':[{'id':r.id,'at':r.created_at,'user':r.user_email,'action':r.action,'target_type':r.target_type,'target_id':r.target_id,'details':r.details} for r in rows]}

# ---------- System admin ----------

def service_health():
    result={'database':False,'redis':None,'storage':None,'queue_mode':settings.queue_mode,'database_kind':engine.dialect.name}
    try:
        with engine.connect() as c: c.exec_driver_sql('select 1');result['database']=True
    except Exception: pass
    if settings.queue_mode=='celery':
        try:
            import redis
            result['redis']=bool(redis.Redis.from_url(settings.redis_url,socket_timeout=2).ping())
        except Exception: result['redis']=False
    try: result['storage']=storage.ping()
    except Exception: result['storage']=False
    return result

@router.get('/api/system/overview')
def system_overview(actor=Depends(system_admin)):
    from .backup import list_backups
    with Session() as db:
        companies=[{'id':c.id,'name':c.name,'timezone':c.timezone,'disabled':c.disabled,'created_at':c.created_at,
            'members':db.scalar(select(func.count()).select_from(Membership).where(Membership.company_id==c.id)) or 0,**usage(db,c.id)}
            for c in db.scalars(select(Company).order_by(Company.name))]
        by_status=dict(db.execute(select(ContentPlatform.status,func.count()).group_by(ContentPlatform.status)).all())
        queue={'by_status':by_status,
            'due_now':db.scalar(select(func.count()).select_from(ContentPlatform).where(ContentPlatform.status=='pending',ContentPlatform.next_attempt_at<=now())) or 0,
            'scheduled':db.scalar(select(func.count()).select_from(ContentPlatform).where(ContentPlatform.status=='pending',ContentPlatform.next_attempt_at>now())) or 0,
            'stuck_sending':db.scalar(select(func.count()).select_from(ContentPlatform).where(ContentPlatform.status=='sending',ContentPlatform.updated_at<now()-900)) or 0,
            'media_processing':db.scalar(select(func.count()).select_from(MediaAsset).where(MediaAsset.status.in_(('processing','converting')))) or 0,
            'media_failed':db.scalar(select(func.count()).select_from(MediaAsset).where(MediaAsset.status=='failed')) or 0}
        names={c['id']:c['name'] for c in companies}
        failures=[{'at':a.finished_at or a.started_at,'company':names.get(c.company_id,''),'platform':d.platform,'outcome':a.outcome,'error_code':a.error_code,'error':a.error_message,'stage':a.stage}
            for a,d,c in db.execute(select(DeliveryAttempt,ContentPlatform,Content).join(ContentPlatform,ContentPlatform.id==DeliveryAttempt.delivery_id).join(Content,Content.id==ContentPlatform.content_id)
                .where(DeliveryAttempt.outcome.in_(('failed','unknown','retry'))).order_by(DeliveryAttempt.started_at.desc()).limit(50))]
        errors=dict(db.execute(select(ContentPlatform.error_code,func.count()).where(ContentPlatform.status.in_(('failed','unknown')),ContentPlatform.error_code.is_not(None)).group_by(ContentPlatform.error_code)).all())
    return {'companies':companies,'queue':queue,'failures':failures,'error_codes':errors,'health':service_health(),'backups':list_backups()[:20],'storage':'cloudinary' if storage.enabled() else 'local'}

class NewCompany(BaseModel):
    name:str=Field(min_length=1,max_length=120)
    timezone:str=Field(default='Europe/Istanbul',max_length=64)
    admin_email:str=Field(max_length=254)
    admin_name:str=Field(default='',max_length=120)

@router.post('/api/system/companies')
def create_company(data:NewCompany,actor=Depends(system_admin)):
    if data.timezone not in available_timezones(): raise HTTPException(400,'Geçerli bir saat dilimi seç.')
    with Session() as db:
        c=Company(name=data.name.strip(),timezone=data.timezone);db.add(c);db.flush()
        user,password=find_or_create_user(db,data.admin_email,data.admin_name)
        db.add(Membership(company_id=c.id,user_id=user.id,role='admin'))
        audit(db,actor,'system.company_created','company',c.id,company_id=c.id,name=c.name,admin=user.email)
        db.commit()
        return {'ok':True,'id':c.id,'admin_email':user.email,'temporary_password':password}

class CompanyStatus(BaseModel): disabled:bool

@router.patch('/api/system/companies/{company_id}')
def set_company_status(company_id:str,data:CompanyStatus,actor=Depends(system_admin)):
    with Session() as db:
        c=db.get(Company,company_id)
        if not c: raise HTTPException(404,'Şirket bulunamadı.')
        c.disabled=data.disabled
        audit(db,actor,'system.company_'+('disabled' if data.disabled else 'enabled'),'company',c.id,company_id=c.id);db.commit()
    return {'ok':True}

@router.post('/api/system/backup')
def run_backup(actor=Depends(system_admin)):
    from .backup import create_backup,verify_backup
    result=create_backup();check=verify_backup(result['file'])
    with Session() as db: audit(db,actor,'system.backup','backup',result['file'],company_id=None,verified=check['ok']);db.commit()
    return {**result,'verified':check['ok'],'mismatches':check['mismatches']}

@router.post('/api/system/backup/{name}/verify')
def verify(name:str,actor=Depends(system_admin)):
    from .backup import verify_backup
    if not re.fullmatch(r'akis-\d{8}-\d{6}\.json\.gz',name): raise HTTPException(400,'Geçersiz yedek adı.')
    try: return verify_backup(name)
    except FileNotFoundError: raise HTTPException(404,'Yedek bulunamadı.')
