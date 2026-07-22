from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigurationError(ValueError):
    """Raised when required configuration is absent or invalid."""


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc
    if value < 1:
        raise ConfigurationError(f"{name} must be at least 1")
    return value


def _boolean(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be true or false")


def _positive_float(name: str, default: float, *, minimum: float = 0.0, maximum: float = 1.0) -> float:
    raw = os.getenv(name, str(default))
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number") from exc
    if value < minimum or value > maximum:
        raise ConfigurationError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class Settings:
    base_url: str
    consumer_key: str
    consumer_secret: str
    timeout_seconds: int = 30
    verify_ssl: bool = True
    max_retries: int = 3
    fuzzy_threshold: float = 0.88
    enable_fuzzy: bool = True

    @classmethod
    def from_env(cls) -> "Settings":
        values = {
            "WC_URL": os.getenv("WC_URL", "").strip(),
            "WC_CONSUMER_KEY": os.getenv("WC_CONSUMER_KEY", "").strip(),
            "WC_CONSUMER_SECRET": os.getenv("WC_CONSUMER_SECRET", "").strip(),
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise ConfigurationError(f"Missing required settings: {', '.join(missing)}")

        base_url = values["WC_URL"].rstrip("/")
        if not base_url.startswith(("http://", "https://")):
            raise ConfigurationError("WC_URL must start with http:// or https://")

        return cls(
            base_url=base_url,
            consumer_key=values["WC_CONSUMER_KEY"],
            consumer_secret=values["WC_CONSUMER_SECRET"],
            timeout_seconds=_positive_int("WC_TIMEOUT_SECONDS", 30),
            verify_ssl=_boolean("WC_VERIFY_SSL", True),
            max_retries=_positive_int("WC_MAX_RETRIES", 3),
            fuzzy_threshold=_positive_float("WC_FUZZY_THRESHOLD", 0.88),
            enable_fuzzy=_boolean("WC_ENABLE_FUZZY", True),
        )
