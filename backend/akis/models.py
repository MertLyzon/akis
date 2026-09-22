import time
from uuid import uuid4
from sqlalchemy import String, Text, Integer, Float, Boolean, ForeignKey, JSON, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def uid(): return str(uuid4())
def now(): return int(time.time())

class Content(Base):
    __tablename__ = 'contents'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    created_by: Mapped[str] = mapped_column(String(100), index=True)
    body_text: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    status: Mapped[str] = mapped_column(String(30), default='draft')
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    fingerprint: Mapped[str] = mapped_column(String(64), default='')

class MediaAsset(Base):
    __tablename__ = 'media_assets'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(100), index=True)
    content_id: Mapped[str | None] = mapped_column(ForeignKey('contents.id'), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(180))
    mime_type: Mapped[str] = mapped_column(String(80))
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    is_auto_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    source_asset_id: Mapped[str | None] = mapped_column(ForeignKey('media_assets.id'), nullable=True)
    variant: Mapped[str] = mapped_column(String(30), default='source')
    status: Mapped[str] = mapped_column(String(30), default='processing')
    note: Mapped[str] = mapped_column(Text, default='')
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    updated_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (UniqueConstraint('source_asset_id', 'variant', name='uq_asset_variant'),)

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

class Credential(Base):
    __tablename__ = 'credentials'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(100))
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
    __table_args__ = (UniqueConstraint('owner','platform',name='uq_credential_owner_platform'),)

class OAuthApp(Base):
    __tablename__ = 'oauth_apps'
    platform: Mapped[str] = mapped_column(String(20), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(250))
    client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    redirect_uri: Mapped[str] = mapped_column(String(600))
    mode: Mapped[str] = mapped_column(String(20), default='web')

class OAuthState(Base):
    __tablename__ = 'oauth_states'
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner: Mapped[str] = mapped_column(String(100))
    session_hash: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(20))
    verifier: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int] = mapped_column(Integer)
    used: Mapped[bool] = mapped_column(Boolean, default=False)

class Broadcast(Base):
    __tablename__ = 'broadcast'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    template_id: Mapped[str] = mapped_column(String(150), default='')
    recipient_list: Mapped[list] = mapped_column(JSON)
    content_id: Mapped[str] = mapped_column(ForeignKey('contents.id'), unique=True)
    status: Mapped[str] = mapped_column(String(30), default='pending')
    sent_at: Mapped[int | None] = mapped_column(Integer, nullable=True)

class AppSetting(Base):
    __tablename__ = 'app_settings'
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
