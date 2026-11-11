import os

import httpx


class DeliveryError(Exception):
    """Safe error: never include Telegram URLs, tokens or recipient identifiers."""


def send_telegram(chat_id: str, text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise DeliveryError("Telegram chưa được cấu hình")
    try:
        # Do not enable HTTP debug/access logging: the Bot API embeds its token
        # in the URL. Never propagate request/response exception details.
        with httpx.Client(timeout=8, follow_redirects=False) as client:
            response = client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "protect_content": True},
            )
        if response.status_code != 200 or response.json().get("ok") is not True:
            raise DeliveryError("Không thể gửi Telegram")
    except (httpx.HTTPError, ValueError, AttributeError):
        raise DeliveryError("Không thể gửi Telegram") from None
