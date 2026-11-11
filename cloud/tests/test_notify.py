import json
from datetime import UTC, datetime
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cloud.notify.fallback import FallbackService
from cloud.notify.router import authorized_scope, router
from cloud.notify.telegram import DeliveryError, send_telegram


def event(kind="BED_EXIT", acknowledged_by=None):
    return {"event_id": "e1", "camera_id": "c1", "type": kind,
            "ts": "2026-11-11T00:00:00+00:00", "confidence": .9,
            "acknowledged_by": acknowledged_by}


@pytest.fixture
def setup_service(tmp_path):
    now = [datetime(2026, 11, 11, tzinfo=UTC).timestamp()]
    sender = Mock()
    service = FallbackService(str(tmp_path / "notify.sqlite"), 60, sender, lambda: now[0])
    service.configure("house-a", "123")
    return service, sender, now


def test_deadline_once_and_restart(setup_service):
    service, sender, now = setup_service
    service.record_event("house-a", event())
    now[0] += 59
    service.process_due()
    sender.assert_not_called()
    now[0] += 1
    service = FallbackService(service.path, 60, sender, lambda: now[0])
    service.process_due()
    sender.assert_called_once_with("123", "CareNest: Rời giường · 2026-11-11T00:00:00+00:00 · Chưa được xác nhận.")
    service.record_event("house-a", event())
    service.process_due()
    sender.assert_called_once()


@pytest.mark.parametrize("mode", ["ack", "already_ack", "other", "no_chat"])
def test_no_fallback_when_not_eligible(setup_service, mode):
    service, sender, now = setup_service
    service.record_event("house-a", event("DOOR_APPROACH" if mode == "other" else "BED_EXIT",
                                         "carer" if mode == "already_ack" else None))
    if mode == "ack":
        service.acknowledge("house-a", "e1")
    if mode == "no_chat":
        service.configure("house-a", "")
    now[0] += 90
    service.process_due()
    sender.assert_not_called()


def test_failed_delivery_retries_and_scope_isolation(setup_service):
    service, sender, now = setup_service
    service.record_event("house-a", event())
    service.acknowledge("house-b", "e1")
    sender.side_effect = [DeliveryError("failed"), None]
    now[0] += 60
    service.process_due()
    service.process_due()
    assert sender.call_count == 1
    now[0] += 60
    service.process_due()
    assert sender.call_count == 2


def test_routes_fail_closed_and_save_test(setup_service, monkeypatch):
    service, sender, _ = setup_service
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-only")
    app = FastAPI()
    app.state.fallback = service
    app.include_router(router)
    client = TestClient(app)
    assert client.put("/notify/telegram", json={"chat_id": "789"}).status_code == 503
    app.dependency_overrides[authorized_scope] = lambda: "house-a"
    assert client.get("/notify/telegram").json() == {"chat_id": "123"}
    assert client.put("/notify/telegram", json={"chat_id": "@name"}).status_code == 422
    assert client.put("/notify/telegram", json={"chat_id": "-100123"}).status_code == 200
    assert client.post("/notify/telegram/test").json() == {"sent": True}
    sender.assert_called_once()
    sender.side_effect = DeliveryError("secret must not escape")
    response = client.post("/notify/telegram/test")
    assert response.status_code == 502
    assert "secret" not in response.text
    client.put("/notify/telegram", json={"chat_id": ""})
    assert client.post("/notify/telegram/test").status_code == 400


def test_telegram_text_only_and_safe_errors(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-only-secret")
    calls = []

    def handle(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handle), **kwargs))
    send_telegram("123", "Rời giường · 00:00")
    assert calls == [{"chat_id": "123", "text": "Rời giường · 00:00", "protect_content": True}]
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(401, json={"ok": False})), **kwargs))
    with pytest.raises(DeliveryError) as error:
        send_telegram("123", "test")
    assert "test-only-secret" not in str(error.value)
