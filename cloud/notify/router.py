import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .fallback import FallbackService
from .telegram import DeliveryError

router = APIRouter(prefix="/notify/telegram", tags=["notify"])


async def authorized_scope(request: Request) -> str:
    # Auth must supply this server-side callback and check owner role + OTP for
    # recipient changes. Do not trust user_id/scope from request bodies/headers.
    authorize = getattr(request.app.state, "authorize_notify", None)
    if authorize is None:
        raise HTTPException(503, "Xác thực cấu hình kênh dự phòng chưa được tích hợp")
    scope = await authorize(request)
    if not isinstance(scope, str) or not scope:
        raise HTTPException(403, "Không có quyền cấu hình kênh dự phòng")
    return scope


def service(request: Request) -> FallbackService:
    instance = getattr(request.app.state, "fallback", None)
    if instance is None or not os.environ.get("TELEGRAM_BOT_TOKEN", "").strip():
        raise HTTPException(503, "Kênh Telegram chưa được cấu hình")
    return instance


Scope = Annotated[str, Depends(authorized_scope)]
Service = Annotated[FallbackService, Depends(service)]


class TelegramSettings(BaseModel):
    chat_id: str = Field(max_length=21, pattern=r"^(?:-?[1-9][0-9]{0,19})?$")


@router.get("")
def get_settings(scope: Scope, fallback: Service):
    return {"chat_id": fallback.settings(scope)}


@router.put("")
def save_settings(body: TelegramSettings, scope: Scope, fallback: Service):
    fallback.configure(scope, body.chat_id)
    return {"chat_id": body.chat_id}


@router.post("/test")
def send_test(scope: Scope, fallback: Service):
    try:
        fallback.send_test(scope)
    except ValueError:
        raise HTTPException(400, "Hãy lưu Telegram chat ID trước") from None
    except DeliveryError:
        raise HTTPException(502, "Không thể gửi Telegram. Kiểm tra bot và chat ID.") from None
    return {"sent": True}
