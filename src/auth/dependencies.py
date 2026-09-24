"""FastAPI 认证依赖：从 Cookie 中解析当前登录用户。"""

from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from src.auth.security import decode_access_token
from src.core.config import APP_CONFIG
from src.db.models import User
from src.db.session import get_db


def get_current_user(
    token: str | None = Cookie(default=None, alias=APP_CONFIG.COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    """从 cookie 取 JWT，查库返回 User；缺失/无效/未找到 -> 401。"""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未登录或会话已过期",
    )
    if not token:
        raise credentials_exc
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise credentials_exc from None

    user_id_raw = payload.get("sub")
    if user_id_raw is None:
        raise credentials_exc
    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        raise credentials_exc from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_exc
    return user
