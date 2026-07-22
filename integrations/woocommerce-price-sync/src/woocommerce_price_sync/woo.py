from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

import requests

from .config import Settings

LOGGER = logging.getLogger(__name__)
ProgressCallback = Callable[[str, int, int | None], None]


class WooCommerceError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class WooCommerceClient:
    API_PREFIX = "/wp-json/wc/v3"

    def __init__(
        self,
        settings: Settings,
        session: requests.Session | None = None,
        *,
        on_progress: ProgressCallback | None = None,
    ):
        self.settings = settings
        self.session = session or requests.Session()
        self.on_progress = on_progress
        self.session.auth = (settings.consumer_key, settings.consumer_secret)
        self.session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "woocommerce-price-sync/0.1.0",
            }
        )

    def _emit(self, label: str, current: int, total: int | None = None) -> None:
        if self.on_progress:
            self.on_progress(label, current, total)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.settings.base_url}{self.API_PREFIX}{path}"
        last_error: Exception | None = None
        for attempt in range(1, self.settings.max_retries + 1):
            try:
                response = self.session.request(
                    method,
                    url,
                    params=params,
                    json=json,
                    timeout=self.settings.timeout_seconds,
                    verify=self.settings.verify_ssl,
                )
            except requests.RequestException as exc:
                last_error = exc
                if attempt == self.settings.max_retries:
                    break
                time.sleep(min(2 ** (attempt - 1), 8))
                continue

            if response.status_code < 400:
                try:
                    return response.json()
                except ValueError as exc:
                    raise WooCommerceError(
                        f"WooCommerce returned invalid JSON for {method} {path}",
                        response.status_code,
                    ) from exc

            message = self._error_message(response)
            retryable = response.status_code == 429 or response.status_code >= 500
            if retryable and attempt < self.settings.max_retries:
                retry_after = response.headers.get("Retry-After", "")
                try:
                    delay = min(max(float(retry_after), 0), 30)
                except ValueError:
                    delay = min(2 ** (attempt - 1), 8)
                LOGGER.warning(
                    "WooCommerce request failed (%s); retrying in %.1fs",
                    response.status_code,
                    delay,
                )
                time.sleep(delay)
                continue
            raise WooCommerceError(message, response.status_code)

        raise WooCommerceError(
            f"WooCommerce request failed after {self.settings.max_retries} attempts: {last_error}"
        ) from last_error

    @staticmethod
    def _error_message(response: requests.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            code = payload.get("code")
            message = payload.get("message")
            if code or message:
                return f"WooCommerce error {response.status_code}: {code or ''} {message or ''}".strip()
        text = response.text.strip()
        return f"WooCommerce error {response.status_code}: {text[:500]}"

    def list_products(self) -> list[dict[str, Any]]:
        return self._list_paginated("/products", {"status": "any", "context": "edit"})

    def list_variations(self, product_id: int) -> list[dict[str, Any]]:
        return self._list_paginated(
            f"/products/{product_id}/variations",
            {"status": "any", "context": "edit"},
        )

    def _list_paginated(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        page = 1
        all_rows: list[dict[str, Any]] = []
        label = "Fetching WooCommerce products" if path == "/products" else f"Fetching page for {path}"
        while True:
            self._emit(label, page, None)
            payload = self._request(
                "GET",
                path,
                params={**params, "per_page": 100, "page": page, "orderby": "id", "order": "asc"},
            )
            if not isinstance(payload, list):
                raise WooCommerceError(f"WooCommerce returned a non-list response for {path}")
            rows = [row for row in payload if isinstance(row, dict)]
            all_rows.extend(rows)
            self._emit(f"{label} ({len(all_rows)} loaded)", page, None)
            if len(payload) < 100:
                return all_rows
            page += 1

    def create_product(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "/products", json=payload)
        if not isinstance(result, dict):
            raise WooCommerceError("WooCommerce returned an invalid create-product response")
        return result

    def update_product(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("PUT", f"/products/{product_id}", json=payload)
        if not isinstance(result, dict):
            raise WooCommerceError("WooCommerce returned an invalid update-product response")
        return result

    def create_variation(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", f"/products/{product_id}/variations", json=payload)
        if not isinstance(result, dict):
            raise WooCommerceError("WooCommerce returned an invalid create-variation response")
        return result

    def update_variation(
        self,
        product_id: int,
        variation_id: int,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        result = self._request(
            "PUT",
            f"/products/{product_id}/variations/{variation_id}",
            json=payload,
        )
        if not isinstance(result, dict):
            raise WooCommerceError("WooCommerce returned an invalid update-variation response")
        return result
