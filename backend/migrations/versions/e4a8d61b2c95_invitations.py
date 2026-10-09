"""invitations: company admins invite people instead of attaching accounts directly

Revision ID: e4a8d61b2c95
Revises: c7d2a91e5f30
"""
from alembic import op
import sqlalchemy as sa

revision = 'e4a8d61b2c95'
down_revision = 'c7d2a91e5f30'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('invitations',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('company_id',sa.String(64),nullable=False),
        sa.Column('email',sa.String(254),nullable=False),
        sa.Column('name',sa.String(120),nullable=False),
        sa.Column('role',sa.String(20),nullable=False),
        sa.Column('token_hash',sa.String(64),nullable=False),
        sa.Column('invited_by',sa.String(64),nullable=True),
        sa.Column('created_at',sa.Integer(),nullable=False),
        sa.Column('expires_at',sa.Integer(),nullable=False),
        sa.Column('accepted_at',sa.Integer(),nullable=True),
        sa.Column('accepted_by',sa.String(64),nullable=True),
        sa.Column('revoked',sa.Boolean(),nullable=False),
        sa.UniqueConstraint('token_hash'))
    op.create_index('ix_invitations_company_id','invitations',['company_id'])

def downgrade():
    op.drop_index('ix_invitations_company_id','invitations')
    op.drop_table('invitations')
