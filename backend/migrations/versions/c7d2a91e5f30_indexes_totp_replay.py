"""composite indexes for the hot company/time queries, TOTP replay guard

Single-column indexes that became the leading column of a composite index are dropped:
the composite index serves the same lookups, so keeping both only costs disk and write time.

Revision ID: c7d2a91e5f30
Revises: b41f0c2e9a17
"""
from alembic import op
import sqlalchemy as sa

revision = 'c7d2a91e5f30'
down_revision = 'b41f0c2e9a17'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('users') as b:
        b.add_column(sa.Column('totp_last_counter',sa.BigInteger(),nullable=True))
    with op.batch_alter_table('contents') as b:
        b.drop_index('ix_contents_company_id')
        b.create_index('ix_contents_company_created',['company_id','created_at'])
        b.create_index('ix_contents_asset_id',['asset_id'])
    with op.batch_alter_table('media_assets') as b:
        b.drop_index('ix_media_assets_company_id')
        b.create_index('ix_media_assets_company_created',['company_id','created_at'])
        b.create_index('ix_media_assets_status',['status'])
    with op.batch_alter_table('audit_log') as b:
        b.drop_index('ix_audit_log_company_id')
        b.create_index('ix_audit_log_company_created',['company_id','created_at'])
    with op.batch_alter_table('delivery_attempts') as b:
        b.drop_index('ix_delivery_attempts_delivery_id')
        b.create_index('ix_delivery_attempts_delivery_started',['delivery_id','started_at'])
    with op.batch_alter_table('oauth_states') as b:
        b.create_index('ix_oauth_states_expires_at',['expires_at'])

def downgrade():
    with op.batch_alter_table('oauth_states') as b:
        b.drop_index('ix_oauth_states_expires_at')
    with op.batch_alter_table('delivery_attempts') as b:
        b.drop_index('ix_delivery_attempts_delivery_started')
        b.create_index('ix_delivery_attempts_delivery_id',['delivery_id'])
    with op.batch_alter_table('audit_log') as b:
        b.drop_index('ix_audit_log_company_created')
        b.create_index('ix_audit_log_company_id',['company_id'])
    with op.batch_alter_table('media_assets') as b:
        b.drop_index('ix_media_assets_status')
        b.drop_index('ix_media_assets_company_created')
        b.create_index('ix_media_assets_company_id',['company_id'])
    with op.batch_alter_table('contents') as b:
        b.drop_index('ix_contents_asset_id')
        b.drop_index('ix_contents_company_created')
        b.create_index('ix_contents_company_id',['company_id'])
    with op.batch_alter_table('users') as b:
        b.drop_column('totp_last_counter')
