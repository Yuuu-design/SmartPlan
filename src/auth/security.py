"""密码哈希与 JWT 工具。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from src.core.config import APP_CONFIG


def hash_password(password: str) -> str:
    """bcrypt 哈希密码。"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """校验明文密码与已哈希密码是否匹配。"""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(subject: str) -> str:
    """生成 JWT，subject 写入 sub 字段，过期时间 7 天。"""
    expire = datetime.now(UTC) + timedelta(minutes=APP_CONFIG.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, APP_CONFIG.SECRET_KEY, algorithm=APP_CONFIG.ALGORITHM)


def decode_access_token(token: str) -> dict:
    """解码 JWT；失败抛 JWTError。"""
    try:
        return jwt.decode(token, APP_CONFIG.SECRET_KEY, algorithms=[APP_CONFIG.ALGORITHM])
    except JWTError as exc:
        raise exc
