import time
from uuid import uuid4
from sqlalchemy import String, Text, Integer, Float, Boolean, ForeignKey, JSON, UniqueConstraint, Index, BigInteger
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def uid(): return str(uuid4())
def now(): return int(time.time())

ROLES=('admin','approver','editor','viewer')

class Company(Base):
    __tablename__ = 'companies'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default='Europe/Istanbul')
    require_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)

class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(120), default='')
    password_hash: Mapped[str] = mapped_column(String(300))
    is_system_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    totp_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Last accepted TOTP time step; a code cannot be used twice.
    totp_last_counter: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Bumped on password/2FA change so existing sessions stop working.
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)

class Membership(Base):
    __tablename__ = 'memberships'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    company_id: Mapped[str] = mapped_column(ForeignKey('companies.id'), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    role: Mapped[str] = mapped_column(String(20), default='viewer')
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (UniqueConstraint('company_id','user_id',name='uq_membership'),)

class AuditLog(Base):
    __tablename__ = 'audit_log'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    company_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_email: Mapped[str] = mapped_column(String(254), default='')
    action: Mapped[str] = mapped_column(String(60))
    target_type: Mapped[str] = mapped_column(String(40), default='')
    target_id: Mapped[str] = mapped_column(String(100), default='')
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[int] = mapped_column(Integer, default=now, index=True)
    __table_args__ = (Index('ix_audit_log_company_created','company_id','created_at'),)

class Content(Base):
    __tablename__ = 'contents'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    company_id: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(100), index=True)
    body_text: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    # draft → pending_approval → (rejected | scheduled | processing) → completed/attention
    status: Mapped[str] = mapped_column(String(30), default='draft')
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    fingerprint: Mapped[str] = mapped_column(String(64), default='')
    scheduled_at: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    submitted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default='')
    updated_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (Index('ix_contents_company_created','company_id','created_at'),Index('ix_contents_asset_id','asset_id'))

class MediaAsset(Base):
    __tablename__ = 'media_assets'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    company_id: Mapped[str] = mapped_column(String(64))
    uploaded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_id: Mapped[str | None] = mapped_column(ForeignKey('contents.id'), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(180))
    # Remote copy (Cloudinary). When set, workers download from here if the local file is missing.
    remote_url: Mapped[str | None] = mapped_column(String(600), nullable=True)
    remote_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(80))
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    is_auto_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    source_asset_id: Mapped[str | None] = mapped_column(ForeignKey('media_assets.id'), nullable=True)
    variant: Mapped[str] = mapped_column(String(30), default='source')
    status: Mapped[str] = mapped_column(String(30), default='processing')
    note: Mapped[str] = mapped_column(Text, default='')
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    folder: Mapped[str] = mapped_column(String(80), default='')
    tags: Mapped[list] = mapped_column(JSON, default=list)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    updated_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (UniqueConstraint('source_asset_id', 'variant', name='uq_asset_variant'),Index('ix_media_assets_company_created','company_id','created_at'),Index('ix_media_assets_status','status'))

class ContentPlatform(Base):
    __tablename__ = 'content_platforms'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    content_id: Mapped[str] = mapped_column(ForeignKey('contents.id'), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    recipient: Mapped[str] = mapped_column(String(20), default='')
    status: Mapped[str] = mapped_column(String(30), default='pending')
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_post_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_attempt_at: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[int] = mapped_column(Integer, default=now)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    final_request_started: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint('content_id','platform','recipient',name='uq_content_target'),Index('idx_delivery_due','status','next_attempt_at'))

class DeliveryAttempt(Base):
    __tablename__ = 'delivery_attempts'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    delivery_id: Mapped[str] = mapped_column(ForeignKey('content_platforms.id'))
    started_at: Mapped[int] = mapped_column(Integer, default=now)
    finished_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Step the worker reached, e.g. media_upload / publish / waiting. Never contains tokens.
    stage: Mapped[str] = mapped_column(String(60), default='')
    outcome: Mapped[str] = mapped_column(String(30), default='running')
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (Index('ix_delivery_attempts_delivery_started','delivery_id','started_at'),)

class Credential(Base):
    __tablename__ = 'credentials'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    company_id: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(20))
    account_label: Mapped[str] = mapped_column(String(120), default='')
    account_id: Mapped[str] = mapped_column(String(100), default='')
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    refresh_expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[int] = mapped_column(Integer, default=now)
    refresh_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_kind: Mapped[str] = mapped_column(String(30), default='manual')
    scopes: Mapped[str] = mapped_column(Text, default='')
    connected_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    __table_args__ = (UniqueConstraint('company_id','platform',name='uq_credential_company_platform'),)

class OAuthApp(Base):
    __tablename__ = 'oauth_apps'
    company_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    platform: Mapped[str] = mapped_column(String(20), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(250))
    client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    redirect_uri: Mapped[str] = mapped_column(String(600))
    mode: Mapped[str] = mapped_column(String(20), default='web')

class OAuthState(Base):
    __tablename__ = 'oauth_states'
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    company_id: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[str] = mapped_column(String(64), default='')
    session_hash: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(20))
    verifier: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)

class Broadcast(Base):
    __tablename__ = 'broadcast'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    template_id: Mapped[str] = mapped_column(String(150), default='')
    recipient_list: Mapped[list] = mapped_column(JSON)
    content_id: Mapped[str] = mapped_column(ForeignKey('contents.id'), unique=True)
    status: Mapped[str] = mapped_column(String(30), default='pending')
    sent_at: Mapped[int | None] = mapped_column(Integer, nullable=True)

class Invitation(Base):
    """One-time link that lets a person join a company. Only the token's hash is stored; nothing here
    reveals whether the e-mail already has an account, and nobody becomes a member until they accept."""
    __tablename__ = 'invitations'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    company_id: Mapped[str] = mapped_column(String(64), index=True)
    email: Mapped[str] = mapped_column(String(254))
    name: Mapped[str] = mapped_column(String(120), default='')
    role: Mapped[str] = mapped_column(String(20), default='editor')
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    expires_at: Mapped[int] = mapped_column(Integer)
    accepted_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accepted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

class AppSetting(Base):
    __tablename__ = 'app_settings'
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
