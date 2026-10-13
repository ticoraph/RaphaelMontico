from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.deps import get_session
from app.main import app


@pytest.fixture(autouse=True)
def _override_deps():
    app.dependency_overrides[get_session] = lambda: None
    yield
    app.dependency_overrides.clear()


async def test_index_status_returns_last_updated(monkeypatch):
    last_updated = datetime(2026, 6, 1, 12, 30, tzinfo=UTC)

    async def fake_get_last_updated(session):
        return last_updated

    monkeypatch.setattr("app.routers.index_status.get_last_updated", fake_get_last_updated)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/index-status")

    assert response.status_code == 200
    assert response.json()["last_updated"] == "2026-06-01T12:30:00Z"


async def test_index_status_returns_null_when_empty(monkeypatch):
    async def fake_get_last_updated(session):
        return None

    monkeypatch.setattr("app.routers.index_status.get_last_updated", fake_get_last_updated)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/index-status")

    assert response.status_code == 200
    assert response.json()["last_updated"] is None
