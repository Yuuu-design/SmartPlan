"""认证接口：注册 / 登录 / 登出 / 当前用户。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import get_current_user
from src.auth.security import create_access_token, hash_password, verify_password
from src.core.config import APP_CONFIG
from src.db.models import User, UserSettings
from src.db.session import get_db
from src.schemas.auth import LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/api/v1", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=APP_CONFIG.COOKIE_NAME,
        value=token,
        httponly=True,
        secure=APP_CONFIG.SECURE_COOKIE,
        samesite=APP_CONFIG.SAMESITE,
        max_age=APP_CONFIG.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


@router.post("/auth/register", response_model=UserOut)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> UserOut:
    """注册新用户：邮箱/用户名重复 -> 409；同时创建空 UserSettings。"""
    exists = db.scalar(select(User).where((User.email == payload.email) | (User.username == payload.username)))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="邮箱或用户名已被使用")

    user = User(
        email=payload.email,
        username=payload.username,
        display_name=payload.display_name or payload.username,
        hashed_password=hash_password(payload.password),
    )
    user.settings = UserSettings(schedule_params={})
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=str(user.id))
    _set_session_cookie(response, token)
    return UserOut.model_validate(user)


@router.post("/auth/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> UserOut:
    """登录：account 可为 email 或 username；密码错误 -> 401。"""
    user = db.scalar(
        select(User).where((User.email == payload.account) | (User.username == payload.account))
    )
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号已被禁用")

    token = create_access_token(subject=str(user.id))
    _set_session_cookie(response, token)
    return UserOut.model_validate(user)


@router.post("/auth/logout")
def logout(response: Response) -> dict:
    """登出：删除会话 cookie。"""
    response.delete_cookie(APP_CONFIG.COOKIE_NAME, path="/")
    return {"message": "已退出"}


@router.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> UserOut:
    """获取当前登录用户信息。"""
    return UserOut.model_validate(current_user)
