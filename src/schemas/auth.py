"""认证相关 Pydantic 模型。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=64)
    display_name: str | None = None


class LoginRequest(BaseModel):
    account: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    display_name: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
