"""Celery application (Phase 1).

Uses Redis as broker/backend by default. If Redis is unreachable at import
time — e.g. a laptop without a Redis server — tasks degrade to eager
in-process execution so the product still works end to end (the NFR-02
trade-off is documented in the README).
"""
from __future__ import annotations

import logging

from celery import Celery

from app.config import settings

logger = logging.getLogger("fxgaze.celery")


def _ping_redis(url: str) -> bool:
    try:
        import redis as redis_lib

        client = redis_lib.Redis.from_url(url, socket_connect_timeout=1.5)
        client.ping()
        return True
    except Exception:
        return False


if _ping_redis(settings.broker_url) and not settings.celery_eager:
    app = Celery(
        "fxgaze",
        broker=settings.broker_url,
        backend=settings.result_backend,
        include=["app.tasks.pipeline"],
    )
else:
    if not settings.celery_eager:
        logger.warning(
            "Redis unreachable at %s — running Celery tasks eagerly in-process. "
            "Start Redis for real async queueing.",
            settings.broker_url,
        )
    else:
        logger.info("FXGAZE_CELERY_EAGER=1 — running tasks eagerly in-process.")
    app = Celery("fxgaze", broker=settings.broker_url, backend="cache+memory://")
    app.conf.task_always_eager = True
    app.conf.task_eager_propagates = False
    app.conf.include = ["app.tasks.pipeline"]

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_default_queue="fxgaze",
    broker_connection_retry_on_startup=True,
)

if __name__ == "__main__":  # pragma: no cover
    app.start()
