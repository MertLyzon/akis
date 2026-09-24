"""companies, users, roles, approval, scheduling, audit, delivery attempts, media library, remote storage

Existing single-workspace rows (owner 'local_seedy') are moved into a first company owned by
the admin account created from ADMIN_EMAIL / ADMIN_PASSWORD_HASH.

Revision ID: b41f0c2e9a17
Revises: 82c6deb108cb
"""
import secrets, time, hashlib
from uuid import uuid4
from alembic import op
import sqlalchemy as sa

revision = 'b41f0c2e9a17'
down_revision = '82c6deb108cb'
branch_labels = None
depends_on = None

LEGACY_OWNER='local_seedy'

def upgrade():
    op.create_table('companies',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('name',sa.String(120),nullable=False),
        sa.Column('timezone',sa.String(64),nullable=False),
        sa.Column('require_approval',sa.Boolean(),nullable=False),
        sa.Column('disabled',sa.Boolean(),nullable=False),
        sa.Column('created_at',sa.Integer(),nullable=False))
    op.create_table('users',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('email',sa.String(254),nullable=False,unique=True),
        sa.Column('name',sa.String(120),nullable=False),
        sa.Column('password_hash',sa.String(300),nullable=False),
        sa.Column('is_system_admin',sa.Boolean(),nullable=False),
        sa.Column('totp_secret',sa.Text(),nullable=True),
        sa.Column('totp_enabled',sa.Boolean(),nullable=False),
        sa.Column('session_version',sa.Integer(),nullable=False),
        sa.Column('must_change_password',sa.Boolean(),nullable=False),
        sa.Column('disabled',sa.Boolean(),nullable=False),
        sa.Column('created_at',sa.Integer(),nullable=False))
    op.create_table('memberships',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('company_id',sa.String(64),sa.ForeignKey('companies.id'),nullable=False),
        sa.Column('user_id',sa.String(64),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('role',sa.String(20),nullable=False),
        sa.Column('created_at',sa.Integer(),nullable=False),
        sa.UniqueConstraint('company_id','user_id',name='uq_membership'))
    op.create_index('ix_memberships_company_id','memberships',['company_id'])
    op.create_index('ix_memberships_user_id','memberships',['user_id'])
    op.create_table('audit_log',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('company_id',sa.String(64),nullable=True),
        sa.Column('user_id',sa.String(64),nullable=True),
        sa.Column('user_email',sa.String(254),nullable=False),
        sa.Column('action',sa.String(60),nullable=False),
        sa.Column('target_type',sa.String(40),nullable=False),
        sa.Column('target_id',sa.String(100),nullable=False),
        sa.Column('details',sa.JSON(),nullable=False),
        sa.Column('created_at',sa.Integer(),nullable=False))
    op.create_index('ix_audit_log_company_id','audit_log',['company_id'])
    op.create_index('ix_audit_log_created_at','audit_log',['created_at'])
    op.create_table('delivery_attempts',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('delivery_id',sa.String(64),sa.ForeignKey('content_platforms.id'),nullable=False),
        sa.Column('started_at',sa.Integer(),nullable=False),
        sa.Column('finished_at',sa.Integer(),nullable=True),
        sa.Column('stage',sa.String(60),nullable=False),
        sa.Column('outcome',sa.String(30),nullable=False),
        sa.Column('error_code',sa.String(100),nullable=True),
        sa.Column('error_message',sa.Text(),nullable=True))
    op.create_index('ix_delivery_attempts_delivery_id','delivery_attempts',['delivery_id'])

    # --- Move legacy single-owner data into a first company ---
    conn=op.get_bind()
    has_data=any(conn.execute(sa.text(f'select count(*) from {t}')).scalar() for t in ('contents','credentials','media_assets','oauth_apps'))
    company_id=admin_id=''
    if has_data:
        from akis.config import settings
        stamp=int(time.time());company_id=str(uuid4());admin_id=str(uuid4())
        hashed=settings.admin_password_hash
        if not hashed:
            salt=secrets.token_hex(16);hashed=salt+':'+hashlib.scrypt(secrets.token_urlsafe(24).encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
        conn.execute(sa.text("insert into companies (id,name,timezone,require_approval,disabled,created_at) values (:id,'Şirketim','Europe/Istanbul',:f,:f,:t)"),{'id':company_id,'t':stamp,'f':False})
        conn.execute(sa.text("insert into users (id,email,name,password_hash,is_system_admin,totp_enabled,session_version,must_change_password,disabled,created_at) values (:id,:email,'Sistem yöneticisi',:h,:yes,:no,1,:no,:no,:t)"),{'id':admin_id,'email':settings.admin_email.lower(),'h':hashed,'t':stamp,'yes':True,'no':False})
        conn.execute(sa.text("insert into memberships (id,company_id,user_id,role,created_at) values (:id,:c,:u,'admin',:t)"),{'id':str(uuid4()),'c':company_id,'u':admin_id,'t':stamp})

    with op.batch_alter_table('contents') as b:
        b.add_column(sa.Column('company_id',sa.String(64),nullable=True))
        b.add_column(sa.Column('scheduled_at',sa.Integer(),nullable=True))
        b.add_column(sa.Column('submitted_by',sa.String(64),nullable=True))
        b.add_column(sa.Column('approved_by',sa.String(64),nullable=True))
        b.add_column(sa.Column('approved_at',sa.Integer(),nullable=True))
        b.add_column(sa.Column('review_note',sa.Text(),nullable=False,server_default=''))
        b.add_column(sa.Column('updated_at',sa.Integer(),nullable=False,server_default='0'))
    if has_data:
        conn.execute(sa.text('update contents set company_id=:c'),{'c':company_id})
        conn.execute(sa.text('update contents set created_by=:u where created_by=:o'),{'u':admin_id,'o':LEGACY_OWNER})
        # Content that was already sent counts as approved by the admin who sent it.
        conn.execute(sa.text("update contents set approved_by=:u,approved_at=created_at,submitted_by=:u where status<>'draft'"),{'u':admin_id})
        conn.execute(sa.text('update contents set updated_at=created_at'))
    with op.batch_alter_table('contents') as b:
        b.alter_column('company_id',existing_type=sa.String(64),nullable=False)
        b.create_index('ix_contents_company_id',['company_id'])
        b.create_index('ix_contents_scheduled_at',['scheduled_at'])

    with op.batch_alter_table('media_assets') as b:
        b.drop_index('ix_media_assets_owner')
        b.alter_column('owner',new_column_name='company_id',existing_type=sa.String(100),type_=sa.String(64),existing_nullable=False)
        b.alter_column('size',existing_type=sa.Integer(),type_=sa.BigInteger(),existing_nullable=False)
        b.add_column(sa.Column('uploaded_by',sa.String(64),nullable=True))
        b.add_column(sa.Column('remote_url',sa.String(600),nullable=True))
        b.add_column(sa.Column('remote_id',sa.String(300),nullable=True))
        b.add_column(sa.Column('folder',sa.String(80),nullable=False,server_default=''))
        b.add_column(sa.Column('tags',sa.JSON(),nullable=True))
        b.add_column(sa.Column('archived',sa.Boolean(),nullable=False,server_default=sa.false()))
    conn.execute(sa.text("update media_assets set tags='[]'"))
    if has_data: conn.execute(sa.text('update media_assets set company_id=:c,uploaded_by=:u'),{'c':company_id,'u':admin_id})
    with op.batch_alter_table('media_assets') as b:
        b.alter_column('tags',existing_type=sa.JSON(),nullable=False)
        b.create_index('ix_media_assets_company_id',['company_id'])

    with op.batch_alter_table('credentials') as b:
        b.drop_constraint('uq_credential_owner_platform',type_='unique')
        b.alter_column('owner',new_column_name='company_id',existing_type=sa.String(100),type_=sa.String(64),existing_nullable=False)
        b.add_column(sa.Column('connected_by',sa.String(64),nullable=True))
    if has_data: conn.execute(sa.text('update credentials set company_id=:c,connected_by=:u'),{'c':company_id,'u':admin_id})
    with op.batch_alter_table('credentials') as b:
        b.create_unique_constraint('uq_credential_company_platform',['company_id','platform'])

    # OAuth apps become per company: new composite primary key.
    op.create_table('oauth_apps_new',
        sa.Column('company_id',sa.String(64),nullable=False),
        sa.Column('platform',sa.String(20),nullable=False),
        sa.Column('client_id',sa.String(250),nullable=False),
        sa.Column('client_secret',sa.Text(),nullable=True),
        sa.Column('redirect_uri',sa.String(600),nullable=False),
        sa.Column('mode',sa.String(20),nullable=False),
        sa.PrimaryKeyConstraint('company_id','platform'))
    if has_data: conn.execute(sa.text('insert into oauth_apps_new (company_id,platform,client_id,client_secret,redirect_uri,mode) select :c,platform,client_id,client_secret,redirect_uri,mode from oauth_apps'),{'c':company_id})
    op.drop_table('oauth_apps')
    op.rename_table('oauth_apps_new','oauth_apps')

    # OAuth states live ten minutes; drop in-flight ones instead of migrating them.
    op.drop_table('oauth_states')
    op.create_table('oauth_states',
        sa.Column('id',sa.String(100),primary_key=True),
        sa.Column('company_id',sa.String(64),nullable=False),
        sa.Column('user_id',sa.String(64),nullable=False),
        sa.Column('session_hash',sa.String(64),nullable=False),
        sa.Column('platform',sa.String(20),nullable=False),
        sa.Column('verifier',sa.Text(),nullable=False),
        sa.Column('expires_at',sa.Integer(),nullable=False),
        sa.Column('used',sa.Boolean(),nullable=False))

    # Old public URL setting stays in app_settings; old login throttling rows are keyed differently now.
    conn.execute(sa.text("delete from app_settings where key like 'login:%'"))

def downgrade():
    raise NotImplementedError('Restore from a backup taken before upgrading (scripts/backup.py).')
