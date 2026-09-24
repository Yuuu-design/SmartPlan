"""个人设置接口：资料 / 密码 / 偏好 / 排产参数。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import get_current_user
from src.auth.security import hash_password, verify_password
from src.db.models import User, UserSettings
from src.db.session import get_db
from src.schemas.auth import UserOut
from src.schemas.settings import (
    PasswordUpdate,
    PreferencesUpdate,
    ProfileUpdate,
    ScheduleParamsUpdate,
)

router = APIRouter(prefix="/api/v1", tags=["settings"], dependencies=[Depends(get_current_user)])


def _get_settings(user: User, db: Session) -> UserSettings:
    """获取当前用户设置；不存在则创建空记录（兼容历史数据）。"""
    if user.settings is None:
        user.settings = UserSettings(schedule_params={})
        db.add(user.settings)
        db.commit()
        db.refresh(user)
    return user.settings


@router.get("/settings")
def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """返回当前用户的资料 + 偏好 + 排产参数。"""
    settings = _get_settings(current_user, db)
    return {
        "profile": UserOut.model_validate(current_user),
        "preferences": {
            "theme_color": settings.theme_color,
            "font_scale": settings.font_scale,
            "default_view": settings.default_view,
        },
        "schedule_params": settings.schedule_params or {},
    }


@router.put("/settings/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """更新资料：username 重复 -> 409。"""
    if payload.username is not None and payload.username != current_user.username:
        dup = db.scalar(select(User).where(User.username == payload.username))
        if dup is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已被使用")
        current_user.username = payload.username
    if payload.display_name is not None:
        current_user.display_name = payload.display_name
    if payload.email is not None:
        current_user.email = payload.email
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.put("/settings/password")
def update_password(
    payload: PasswordUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """修改密码：旧密码错误 -> 400。"""
    if not verify_password(payload.old_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="原密码错误")
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"message": "密码已更新"}


@router.put("/settings/preferences")
def update_preferences(
    payload: PreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """更新偏好（theme_color / font_scale / default_view）。"""
    settings = _get_settings(current_user, db)
    if payload.theme_color is not None:
        settings.theme_color = payload.theme_color
    if payload.font_scale is not None:
        settings.font_scale = payload.font_scale
    if payload.default_view is not None:
        settings.default_view = payload.default_view
    db.commit()
    db.refresh(settings)
    return {
        "theme_color": settings.theme_color,
        "font_scale": settings.font_scale,
        "default_view": settings.default_view,
    }


@router.put("/settings/schedule-params")
def update_schedule_params(
    payload: ScheduleParamsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """更新排产参数 JSON（整体覆盖）。"""
    settings = _get_settings(current_user, db)
    settings.schedule_params = payload.schedule_params
    db.commit()
    db.refresh(settings)
    return {"schedule_params": settings.schedule_params or {}}
