import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import rate_limit
from app.config import get_settings
from app.db.base import Base
from app.db.models import Chunk  # noqa: F401  (registers the model on Base.metadata)


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    # Counters are process-wide: without this, requests from one test eat the budget of the next.
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest_asyncio.fixture
async def engine():
    """Function-scoped (not session-scoped) and NullPool: pytest-asyncio gives each
    test its own event loop, and asyncpg connections can't be reused across loops —
    sharing an engine/pool across tests intermittently raises asyncpg.InterfaceError.
    Schema is created from the ORM metadata directly rather than via Alembic, since
    tests don't need migration history, just the current shape of the tables."""
    eng = create_async_engine(get_settings().database_url, poolclass=NullPool)
    async with eng.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE chunks"))
