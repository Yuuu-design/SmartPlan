"""个人设置相关 Pydantic 模型。"""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class ProfileUpdate(BaseModel):
    display_name: str | None = None
    username: str | None = None
    email: EmailStr | None = None


class PasswordUpdate(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


class PreferencesUpdate(BaseModel):
    theme_color: str | None = None
    font_scale: int | None = None
    default_view: str | None = None


class ScheduleParamsUpdate(BaseModel):
    schedule_params: dict
