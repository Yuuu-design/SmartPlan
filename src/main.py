"""SHENGHU SmartPlan 后端入口：聚合所有 v1 路由并启动建表。"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.v1.auth import router as auth_router
from src.api.v1.copilot import router as copilot_router
from src.api.v1.schedule import router as schedule_router
from src.api.v1.settings import router as settings_router
from src.core.config import APP_CONFIG
from src.db.session import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="SHENGHU SmartPlan", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(APP_CONFIG.CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(schedule_router)
app.include_router(copilot_router)
app.include_router(auth_router)
app.include_router(settings_router)
