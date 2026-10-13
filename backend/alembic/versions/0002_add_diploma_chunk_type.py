"""add diploma chunk type

Revision ID: 8c1f2a9b3d40
Revises: 754dda695790
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8c1f2a9b3d40'
down_revision: Union[str, Sequence[str], None] = '754dda695790'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_TYPES = "('blog_post', 'project', 'experience', 'page_section')"
_NEW_TYPES = "('blog_post', 'project', 'experience', 'diploma', 'page_section')"


def upgrade() -> None:
    """Allow the 'diploma' chunk type."""
    op.drop_constraint('ck_chunks_type', 'chunks', type_='check')
    op.create_check_constraint('ck_chunks_type', 'chunks', f"type IN {_NEW_TYPES}")


def downgrade() -> None:
    """Revert to the original chunk types, dropping any diploma chunks."""
    op.execute("DELETE FROM chunks WHERE type = 'diploma'")
    op.drop_constraint('ck_chunks_type', 'chunks', type_='check')
    op.create_check_constraint('ck_chunks_type', 'chunks', f"type IN {_OLD_TYPES}")
