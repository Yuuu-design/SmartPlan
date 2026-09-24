"""ORM 模型：User 与 UserSettings。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from src.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(128), unique=True, index=True, nullable=False)
    username = Column(String(64), unique=True, nullable=False)
    display_name = Column(String(64), default="", nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), nullable=False)

    settings = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    theme_color = Column(String(16), default="cyan", nullable=False)
    font_scale = Column(Integer, default=100, nullable=False)
    default_view = Column(String(16), default="ORDER", nullable=False)
    schedule_params = Column(JSON, default=dict, nullable=False)

    user = relationship("User", back_populates="settings")
