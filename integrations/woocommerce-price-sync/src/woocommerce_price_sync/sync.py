from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any, Protocol

from .matching import ProductIndex, attribute_pair_matches
from .models import ExcelProduct, ProductKind, SyncResult, WorkbookData
from .normalization import decimal_to_string, normalize_text, prices_equal, stock_status_equal

LOGGER = logging.getLogger(__name__)
ProgressCallback = Callable[[int, int, str], None]


class WooClient(Protocol):
    def list_products(self) -> list[dict[str, Any]]: ...
    def list_variations(self, product_id: int) -> list[dict[str, Any]]: ...
    def create_product(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    def update_product(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]: ...
    def create_variation(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]: ...
    def update_variation(
        self, product_id: int, variation_id: int, payload: dict[str, Any]
    ) -> dict[str, Any]: ...


class PriceSync:
    def __init__(
        self,
        client: WooClient,
        *,
        apply: bool = False,
        on_progress: ProgressCallback | None = None,
        fuzzy_threshold: float = 0.88,
        enable_fuzzy: bool = True,
    ):
        self.client = client
        self.apply = apply
        self.on_progress = on_progress
        self.fuzzy_threshold = fuzzy_threshold
        self.enable_fuzzy = enable_fuzzy

    def run(self, workbook: WorkbookData) -> list[SyncResult]:
        results = [
            SyncResult(
                excel_row=issue.row,
                code=issue.code,
                title=issue.title,
                product_type="unknown",
                match_status="invalid",
                action="error",
                reason=issue.reason,
            )
            for issue in workbook.issues
        ]

        remote_products = self.client.list_products()
        product_index = ProductIndex(
            remote_products,
            fuzzy_threshold=self.fuzzy_threshold,
            enable_fuzzy=self.enable_fuzzy,
        )

        variations_by_parent: dict[str, list[ExcelProduct]] = defaultdict(list)
        for product in workbook.products:
            if product.kind == ProductKind.VARIATION:
                variations_by_parent[product.reference].append(product)

        top_level = [p for p in workbook.products if p.kind != ProductKind.VARIATION]
        processed_variations: set[int] = set()
        total = len(top_level)
        for index, product in enumerate(sorted(top_level, key=lambda row: row.row), start=1):
            if self.on_progress:
                mode = "Applying" if self.apply else "Matching"
                self.on_progress(index, total, f"{mode} Excel products")
            product_match = product_index.find(product)
            candidates = list(product_match.candidates)
            match_reason = product_match.reason_suffix
            if product.kind == ProductKind.SIMPLE:
                results.extend(self._sync_simple(product, candidates, match_reason))
            else:
                children = sorted(variations_by_parent.get(product.code, []), key=lambda row: row.row)
                processed_variations.update(child.row for child in children)
                results.extend(
                    self._sync_variable(
                        product,
                        children,
                        candidates,
                        match_reason,
                    )
                )

        for orphan in sorted(
            (
                p
                for p in workbook.products
                if p.kind == ProductKind.VARIATION and p.row not in processed_variations
            ),
            key=lambda row: row.row,
        ):
            results.append(self._result(orphan, "invalid", "error", reason="Parent was not processed"))

        return sorted(results, key=lambda result: result.excel_row)

    def _sync_simple(
        self,
        product: ExcelProduct,
        candidates: list[dict[str, Any]],
        match_reason: str = "",
    ) -> list[SyncResult]:
        if product.price is None:
            return [self._result(product, "invalid", "error", reason="Missing price")]

        simple_candidates = [
            remote
            for remote in _dedupe_remote_products(candidates)
            if remote.get("type") in {None, "", "simple"}
        ]
        if candidates and not simple_candidates:
            return [
                self._result(
                    product,
                    "type_conflict",
                    "ambiguous",
                    woo_product_id=_id(candidates[0]),
                    reason=(
                        f'Expected simple product, found {candidates[0].get("type") or "unknown"}; '
                        "sync this title as a variable product group instead"
                    ),
                )
            ]

        if not simple_candidates:
            return [self._sync_simple_unmatched(product)]

        shared_reason = match_reason
        if len(simple_candidates) > 1:
            shared_reason = (
                f"{match_reason}; matched {len(simple_candidates)} products with the same title"
                if match_reason
                else f"Matched {len(simple_candidates)} products with the same title"
            )
        return [
            self._sync_simple_remote(product, remote, shared_reason)
            for remote in simple_candidates
        ]

    def _sync_simple_unmatched(self, product: ExcelProduct) -> SyncResult:
        new_price = decimal_to_string(product.price)
        new_stock = product.stock_status or ""
        if not self.apply:
            return self._result(
                product,
                "not_found",
                "would_create",
                new_price=new_price,
                new_stock_status=new_stock,
                reason="No WooCommerce product matched the normalized title",
            )
        try:
            payload = _create_simple_payload(product, new_price)
            created = self.client.create_product(payload)
            return self._result(
                product,
                "created",
                "created",
                woo_product_id=_id(created),
                new_price=new_price,
                new_stock_status=new_stock,
                reason="Created missing simple product as draft",
            )
        except Exception as exc:
            return self._result(
                product,
                "not_found",
                "error",
                new_price=new_price,
                new_stock_status=new_stock,
                reason=str(exc),
            )

    def _sync_simple_remote(
        self,
        product: ExcelProduct,
        remote: dict[str, Any],
        match_reason: str = "",
    ) -> SyncResult:
        new_price = decimal_to_string(product.price)
        new_stock = product.stock_status or ""
        old_price = str(remote.get("regular_price") or "")
        old_stock = str(remote.get("stock_status") or "")
        if _remote_is_current(product, remote, new_price):
            return self._result(
                product,
                "matched",
                "unchanged",
                woo_product_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=_unchanged_reason(product, remote, new_price),
            )
        if not self.apply:
            return self._result(
                product,
                "matched",
                "would_update",
                woo_product_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=match_reason or "Normalized title matched",
            )
        try:
            payload = _update_simple_payload(product, new_price)
            self.client.update_product(_required_id(remote), payload)
            return self._result(
                product,
                "matched",
                "updated",
                woo_product_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=_updated_reason(product, remote, new_price, match_reason),
            )
        except Exception as exc:
            return self._result(
                product,
                "matched",
                "error",
                woo_product_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=str(exc),
            )

    def _sync_variable(
        self,
        parent: ExcelProduct,
        children: list[ExcelProduct],
        candidates: list[dict[str, Any]],
        match_reason: str = "",
    ) -> list[SyncResult]:
        unique_candidates = _dedupe_remote_products(candidates)
        if len(unique_candidates) > 1:
            results: list[SyncResult] = []
            for remote in unique_candidates:
                results.extend(self._sync_variable(parent, children, [remote], match_reason))
            return results

        required_attributes = _build_attributes(children)
        remote_parent: dict[str, Any] | None = unique_candidates[0] if unique_candidates else None
        converted_from_simple = False
        if remote_parent is not None and remote_parent.get("type") == "simple":
            converted_from_simple = True
            if not self.apply:
                parent_result = self._result(
                    parent,
                    "matched",
                    "would_convert",
                    woo_product_id=_id(remote_parent),
                    reason="WooCommerce simple product will be converted to variable",
                )
            else:
                try:
                    remote_parent = self.client.update_product(
                        _required_id(remote_parent),
                        {
                            "type": "variable",
                            "regular_price": "",
                            "sale_price": "",
                            "attributes": required_attributes,
                        },
                    )
                    parent_result = self._result(
                        parent,
                        "matched",
                        "converted",
                        woo_product_id=_id(remote_parent),
                        reason="Converted WooCommerce simple product to variable",
                    )
                except Exception as exc:
                    return [
                        self._result(
                            parent,
                            "matched",
                            "error",
                            woo_product_id=_id(remote_parent),
                            reason=f"Could not convert simple product to variable: {exc}",
                        ),
                        *[
                            self._result(
                                child,
                                "matched",
                                "error",
                                woo_product_id=_id(remote_parent),
                                new_price=decimal_to_string(child.price),
                                reason=f"Parent conversion failed: {exc}",
                            )
                            for child in children
                        ],
                    ]
        elif remote_parent is None:
            parent_action = "created" if self.apply else "would_create"
            if self.apply:
                try:
                    remote_parent = self.client.create_product(
                        {
                            "name": parent.title,
                            "sku": parent.code,
                            "type": "variable",
                            "status": "draft",
                            "attributes": required_attributes,
                        }
                    )
                except Exception as exc:
                    return [
                        self._result(parent, "not_found", "error", reason=str(exc)),
                        *[
                            self._result(
                                child,
                                "not_found",
                                "error",
                                new_price=decimal_to_string(child.price),
                                reason=f"Parent creation failed: {exc}",
                            )
                            for child in children
                        ],
                    ]
            parent_result = self._result(
                parent,
                "created" if self.apply else "not_found",
                parent_action,
                woo_product_id=_id(remote_parent),
                reason=(
                    "Created missing variable parent as draft"
                    if self.apply
                    else "No WooCommerce variable parent matched the normalized title"
                ),
            )
        elif not converted_from_simple:
            parent_result = self._result(
                parent,
                "matched",
                "unchanged",
                woo_product_id=_id(remote_parent),
                reason="Variable parent matched by normalized title"
                if not match_reason
                else match_reason,
            )

        if remote_parent is None:
            return [
                parent_result,
                *[
                    self._result(
                        child,
                        "not_found",
                        "would_create",
                        new_price=decimal_to_string(child.price),
                        reason="Variation will be created after its parent",
                    )
                    if child.price is not None
                    else self._result(child, "invalid", "error", reason="Missing price")
                    for child in children
                ],
            ]

        parent_id = _required_id(remote_parent)
        try:
            remote_variations = self.client.list_variations(parent_id)
        except Exception as exc:
            return [
                parent_result,
                *[
                    self._result(
                        child,
                        "error",
                        "error",
                        woo_product_id=parent_id,
                        new_price=decimal_to_string(child.price),
                        reason=f"Could not list variations: {exc}",
                    )
                    for child in children
                ],
            ]

        variation_matches: dict[int, list[dict[str, Any]]] = {
            child.row: _match_variation_candidates(
                child,
                remote_variations,
                remote_parent,
                fuzzy_threshold=self.fuzzy_threshold,
                enable_fuzzy=self.enable_fuzzy,
            )
            for child in children
        }
        missing_children = [
            child
            for child in children
            if not variation_matches[child.row] and child.price is not None
        ]

        attribute_error = ""
        if (
            missing_children
            and remote_parent is not None
            and remote_parent.get("type") == "variable"
        ):
            merged_attributes, changed = _merge_attributes(
                remote_parent.get("attributes") or [],
                _build_attributes(missing_children),
            )
            if changed and self.apply:
                try:
                    updated_parent = self.client.update_product(
                        parent_id,
                        {"attributes": merged_attributes},
                    )
                    if isinstance(updated_parent.get("attributes"), list):
                        remote_parent = updated_parent
                    else:
                        remote_parent = {**remote_parent, "attributes": merged_attributes}
                except Exception as exc:
                    attribute_error = f"Could not add required parent attribute option: {exc}"

        child_results: list[SyncResult] = []
        for child in children:
            child_results.extend(
                self._sync_variation(
                    parent_id,
                    remote_parent,
                    child,
                    variation_matches[child.row],
                    attribute_error if not variation_matches[child.row] else "",
                )
            )
        return [parent_result, *child_results]

    def _sync_variation(
        self,
        parent_id: int,
        remote_parent: dict[str, Any],
        child: ExcelProduct,
        candidates: list[dict[str, Any]],
        creation_blocker: str,
    ) -> list[SyncResult]:
        if child.price is None:
            return [
                self._result(
                    child,
                    "invalid",
                    "error",
                    woo_product_id=parent_id,
                    reason="Missing price",
                )
            ]
        new_price = decimal_to_string(child.price)
        new_stock = child.stock_status or ""
        unique_candidates = _dedupe_remote_variations(candidates)
        if len(unique_candidates) > 1:
            shared_reason = f"Matched {len(unique_candidates)} variations with the same attribute/value"
            return [
                self._sync_variation_remote(
                    parent_id,
                    child,
                    remote,
                    new_price,
                    new_stock,
                    shared_reason,
                )
                for remote in unique_candidates
            ]
        if not unique_candidates:
            if creation_blocker:
                return [
                    self._result(
                        child,
                        "not_found",
                        "error",
                        woo_product_id=parent_id,
                        new_price=new_price,
                        reason=creation_blocker,
                    )
                ]
            if not self.apply:
                return [
                    self._result(
                        child,
                        "not_found",
                        "would_create",
                        woo_product_id=parent_id,
                        new_price=new_price,
                        new_stock_status=new_stock,
                        reason="No variation matched the normalized attribute/value",
                    )
                ]
            try:
                payload = _create_variation_payload(child, remote_parent, new_price)
                created = self.client.create_variation(parent_id, payload)
                return [
                    self._result(
                        child,
                        "created",
                        "created",
                        woo_product_id=parent_id,
                        woo_variation_id=_id(created),
                        new_price=new_price,
                        new_stock_status=new_stock,
                        reason="Created missing variation as draft",
                    )
                ]
            except Exception as exc:
                return [
                    self._result(
                        child,
                        "not_found",
                        "error",
                        woo_product_id=parent_id,
                        new_price=new_price,
                        new_stock_status=new_stock,
                        reason=str(exc),
                    )
                ]

        return [
            self._sync_variation_remote(
                parent_id,
                child,
                unique_candidates[0],
                new_price,
                new_stock,
                "Variation matched by normalized attribute/value",
            )
        ]

    def _sync_variation_remote(
        self,
        parent_id: int,
        child: ExcelProduct,
        remote: dict[str, Any],
        new_price: str,
        new_stock: str,
        match_reason: str,
    ) -> SyncResult:
        old_price = str(remote.get("regular_price") or "")
        old_stock = str(remote.get("stock_status") or "")
        if _remote_is_current(child, remote, new_price):
            return self._result(
                child,
                "matched",
                "unchanged",
                woo_product_id=parent_id,
                woo_variation_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=_unchanged_reason(child, remote, new_price),
            )
        if not self.apply:
            return self._result(
                child,
                "matched",
                "would_update",
                woo_product_id=parent_id,
                woo_variation_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=match_reason,
            )
        try:
            payload = _update_variation_payload(child, new_price)
            self.client.update_variation(
                parent_id,
                _required_id(remote),
                payload,
            )
            return self._result(
                child,
                "matched",
                "updated",
                woo_product_id=parent_id,
                woo_variation_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=_updated_reason(child, remote, new_price, match_reason),
            )
        except Exception as exc:
            return self._result(
                child,
                "matched",
                "error",
                woo_product_id=parent_id,
                woo_variation_id=_id(remote),
                old_price=old_price,
                new_price=new_price,
                old_stock_status=old_stock,
                new_stock_status=new_stock,
                reason=str(exc),
            )

    @staticmethod
    def _result(
        product: ExcelProduct,
        match_status: str,
        action: str,
        *,
        woo_product_id: int | None = None,
        woo_variation_id: int | None = None,
        old_price: str = "",
        new_price: str = "",
        old_stock_status: str = "",
        new_stock_status: str = "",
        reason: str = "",
    ) -> SyncResult:
        return SyncResult(
            excel_row=product.row,
            code=product.code,
            title=product.title,
            product_type=product.kind.value,
            attribute_name=product.attribute_name,
            attribute_value=product.attribute_value,
            match_status=match_status,
            action=action,
            woo_product_id=woo_product_id,
            woo_variation_id=woo_variation_id,
            old_price=old_price,
            new_price=new_price,
            old_stock_status=old_stock_status,
            new_stock_status=new_stock_status,
            reason=reason,
        )


def _id(remote: dict[str, Any] | None) -> int | None:
    if not remote:
        return None
    value = remote.get("id")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _required_id(remote: dict[str, Any]) -> int:
    value = _id(remote)
    if value is None:
        raise ValueError("WooCommerce response is missing a numeric id")
    return value


def _create_simple_payload(product: ExcelProduct, new_price: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": product.title,
        "sku": product.code,
        "type": "simple",
        "status": "draft",
        "regular_price": new_price,
    }
    if product.stock_status is not None:
        payload["stock_status"] = product.stock_status
    return payload


def _update_simple_payload(product: ExcelProduct, new_price: str) -> dict[str, Any]:
    payload: dict[str, Any] = {"regular_price": new_price}
    if product.stock_status is not None:
        payload["stock_status"] = product.stock_status
    return payload


def _create_variation_payload(
    child: ExcelProduct,
    remote_parent: dict[str, Any],
    new_price: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sku": child.code,
        "status": "draft",
        "regular_price": new_price,
        "attributes": [_variation_attribute_payload(remote_parent, child)],
    }
    if child.stock_status is not None:
        payload["stock_status"] = child.stock_status
    return payload


def _update_variation_payload(child: ExcelProduct, new_price: str) -> dict[str, Any]:
    payload: dict[str, Any] = {"regular_price": new_price}
    if child.stock_status is not None:
        payload["stock_status"] = child.stock_status
    return payload


def _remote_is_current(product: ExcelProduct, remote: dict[str, Any], new_price: str) -> bool:
    price_ok = prices_equal(remote.get("regular_price"), product.price)
    if product.stock_status is None:
        return price_ok
    return price_ok and stock_status_equal(remote.get("stock_status"), product.stock_status)


def _unchanged_reason(product: ExcelProduct, remote: dict[str, Any], new_price: str) -> str:
    parts: list[str] = []
    if prices_equal(remote.get("regular_price"), product.price):
        parts.append("regular price is already current")
    if product.stock_status is not None and stock_status_equal(
        remote.get("stock_status"), product.stock_status
    ):
        parts.append("stock status is already current")
    return " and ".join(parts) or "Already current"


def _updated_reason(
    product: ExcelProduct,
    remote: dict[str, Any],
    new_price: str,
    match_reason: str = "",
) -> str:
    parts: list[str] = []
    if not prices_equal(remote.get("regular_price"), product.price):
        parts.append("regular price")
    if product.stock_status is not None and not stock_status_equal(
        remote.get("stock_status"), product.stock_status
    ):
        parts.append("stock status")
    if not parts:
        return match_reason or "Updated product fields"
    detail = f"Updated {' and '.join(parts)} only"
    if match_reason:
        return f"{detail}; {match_reason}"
    return detail


def _build_attributes(children: list[ExcelProduct]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for child in children:
        key = normalize_text(child.attribute_name)
        group = grouped.setdefault(
            key,
            {
                "name": child.attribute_name,
                "visible": True,
                "variation": True,
                "options": [],
                "_seen": set(),
            },
        )
        option_key = normalize_text(child.attribute_value)
        if option_key not in group["_seen"]:
            group["_seen"].add(option_key)
            group["options"].append(child.attribute_value)
    result: list[dict[str, Any]] = []
    for group in grouped.values():
        group.pop("_seen", None)
        result.append(group)
    return result


def _merge_attributes(
    existing: list[dict[str, Any]],
    required: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    merged = [
        {
            key: value
            for key, value in attribute.items()
            if key in {"id", "name", "position", "visible", "variation", "options"}
        }
        for attribute in existing
        if isinstance(attribute, dict)
    ]
    changed = False
    by_name = {normalize_text(attribute.get("name")): attribute for attribute in merged}
    for requirement in required:
        key = normalize_text(requirement.get("name"))
        target = by_name.get(key)
        if target is None:
            target = dict(requirement)
            merged.append(target)
            by_name[key] = target
            changed = True
            continue
        target["variation"] = True
        current_options = list(target.get("options") or [])
        normalized_options = {normalize_text(option) for option in current_options}
        for option in requirement.get("options") or []:
            if normalize_text(option) not in normalized_options:
                current_options.append(option)
                normalized_options.add(normalize_text(option))
                changed = True
        target["options"] = current_options
    return merged, changed


def _match_variation_candidates(
    child: ExcelProduct,
    remote_variations: list[dict[str, Any]],
    remote_parent: dict[str, Any],
    *,
    fuzzy_threshold: float = 0.88,
    enable_fuzzy: bool = True,
) -> list[dict[str, Any]]:
    by_attribute = [
        remote
        for remote in remote_variations
        if _variation_has_attribute(remote, remote_parent, child)
    ]
    if by_attribute:
        return by_attribute
    if enable_fuzzy:
        fuzzy_matches = [
            remote
            for remote in remote_variations
            if _variation_has_fuzzy_attribute(
                remote,
                remote_parent,
                child,
                threshold=fuzzy_threshold,
            )
        ]
        if fuzzy_matches:
            return fuzzy_matches
    return []


def _variation_has_fuzzy_attribute(
    variation: dict[str, Any],
    parent: dict[str, Any],
    child: ExcelProduct,
    *,
    threshold: float,
) -> bool:
    parent_names = {
        attribute.get("id"): attribute.get("name")
        for attribute in parent.get("attributes") or []
        if isinstance(attribute, dict) and attribute.get("id")
    }
    for attribute in variation.get("attributes") or []:
        if not isinstance(attribute, dict):
            continue
        name = attribute.get("name") or parent_names.get(attribute.get("id"))
        if attribute_pair_matches(name, attribute.get("option"), child, threshold=threshold):
            return True
    return False


def _variation_has_attribute(
    variation: dict[str, Any],
    parent: dict[str, Any],
    child: ExcelProduct,
) -> bool:
    parent_names = {
        attribute.get("id"): attribute.get("name")
        for attribute in parent.get("attributes") or []
        if isinstance(attribute, dict) and attribute.get("id")
    }
    expected_name = normalize_text(child.attribute_name)
    expected_value = normalize_text(child.attribute_value)
    for attribute in variation.get("attributes") or []:
        if not isinstance(attribute, dict):
            continue
        name = attribute.get("name") or parent_names.get(attribute.get("id"))
        if (
            normalize_text(name) == expected_name
            and normalize_text(attribute.get("option")) == expected_value
        ):
            return True
    return False


def _variation_attribute_payload(
    parent: dict[str, Any],
    child: ExcelProduct,
) -> dict[str, Any]:
    expected_name = normalize_text(child.attribute_name)
    for attribute in parent.get("attributes") or []:
        if not isinstance(attribute, dict):
            continue
        if normalize_text(attribute.get("name")) != expected_name:
            continue
        attribute_id = attribute.get("id")
        if isinstance(attribute_id, int) and attribute_id > 0:
            return {"id": attribute_id, "option": child.attribute_value}
        return {"name": child.attribute_name, "option": child.attribute_value}
    return {"name": child.attribute_name, "option": child.attribute_value}


def _dedupe_remote_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[int] = set()
    unique: list[dict[str, Any]] = []
    for product in products:
        product_id = _id(product)
        if product_id is None:
            unique.append(product)
            continue
        if product_id in seen:
            continue
        seen.add(product_id)
        unique.append(product)
    return unique


def _dedupe_remote_variations(variations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[int] = set()
    unique: list[dict[str, Any]] = []
    for variation in variations:
        variation_id = _id(variation)
        if variation_id is None:
            unique.append(variation)
            continue
        if variation_id in seen:
            continue
        seen.add(variation_id)
        unique.append(variation)
    return unique
