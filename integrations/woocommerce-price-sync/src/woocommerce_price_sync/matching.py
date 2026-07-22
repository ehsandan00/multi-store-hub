from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from .models import ExcelProduct
from .normalization import normalize_text

DEFAULT_FUZZY_THRESHOLD = 0.88


@dataclass(frozen=True)
class ProductMatch:
    candidates: tuple[dict[str, Any], ...]
    method: str
    score: float | None = None

    @property
    def reason_suffix(self) -> str:
        if self.method == "exact_title":
            return "Normalized title matched"
        if self.method == "exact_title_variation":
            return "Matched by title and variation value"
        if self.method == "fuzzy_title" and self.score is not None:
            return f"Fuzzy title matched (score {self.score:.2f})"
        if self.method == "fuzzy_title_variation" and self.score is not None:
            return f"Fuzzy title+variation matched (score {self.score:.2f})"
        return ""


class ProductIndex:
    def __init__(
        self,
        remote_products: list[dict[str, Any]],
        *,
        fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
        enable_fuzzy: bool = True,
    ):
        self.fuzzy_threshold = fuzzy_threshold
        self.enable_fuzzy = enable_fuzzy
        self.title_index: dict[str, list[dict[str, Any]]] = {}
        self.title_keys: list[str] = []

        for remote in remote_products:
            title = normalize_text(remote.get("name"))
            if title:
                self.title_index.setdefault(title, []).append(remote)

        self.title_keys = list(self.title_index.keys())

    def find(self, product: ExcelProduct) -> ProductMatch:
        title_key = normalize_text(product.title)
        exact = self.title_index.get(title_key, [])
        if exact:
            return ProductMatch(tuple(_dedupe_by_id(exact)), "exact_title")

        if self.enable_fuzzy and title_key and self.title_keys:
            fuzzy = _fuzzy_title_match(title_key, self.title_keys, self.title_index, self.fuzzy_threshold)
            if fuzzy is not None:
                return fuzzy

        return ProductMatch((), "none")

    def find_variation(self, product: ExcelProduct) -> ProductMatch:
        """Match a variation row to a top-level catalog product by title + variation."""
        title_key = normalize_text(product.title)
        variation_value = normalize_text(product.attribute_value)

        if variation_value:
            combined_key = normalize_text(f"{product.title} {product.attribute_value}")
            combined_exact = self.title_index.get(combined_key, [])
            if combined_exact:
                simple_hits = _simple_products(_dedupe_by_id(combined_exact))
                if len(simple_hits) == 1:
                    return ProductMatch((simple_hits[0],), "exact_title_variation")

            if self.enable_fuzzy and combined_key:
                fuzzy = _fuzzy_title_match(
                    combined_key,
                    self.title_keys,
                    self.title_index,
                    self.fuzzy_threshold,
                    product_types={"simple"},
                )
                if fuzzy is not None and fuzzy.candidates:
                    return ProductMatch(fuzzy.candidates, "fuzzy_title_variation", fuzzy.score)

        title_hits = _simple_products(_dedupe_by_id(self.title_index.get(title_key, [])))
        if len(title_hits) == 1:
            return ProductMatch((title_hits[0],), "exact_title")

        if self.enable_fuzzy and title_key:
            fuzzy = _fuzzy_title_match(
                title_key,
                self.title_keys,
                self.title_index,
                self.fuzzy_threshold,
                product_types={"simple"},
            )
            if fuzzy is not None and fuzzy.candidates:
                return ProductMatch(fuzzy.candidates, "fuzzy_title", fuzzy.score)

        return ProductMatch((), "none")


def variation_search_key(product: ExcelProduct) -> str:
    if product.attribute_value:
        return normalize_text(f"{product.title} {product.attribute_value}")
    return normalize_text(product.title)


def fuzzy_ratio(left: object, right: object) -> float:
    a = normalize_text(left)
    b = normalize_text(right)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def attribute_pair_matches(
    remote_name: object,
    remote_value: object,
    child: ExcelProduct,
    *,
    threshold: float,
) -> bool:
    name_score = fuzzy_ratio(remote_name, child.attribute_name)
    value_score = fuzzy_ratio(remote_value, child.attribute_value)
    if name_score >= threshold and value_score >= threshold:
        return True
    combined = normalize_text(f"{remote_name} {remote_value}")
    expected = variation_search_key(child)
    return fuzzy_ratio(combined, expected) >= threshold


def _fuzzy_title_match(
    query: str,
    title_keys: list[str],
    title_index: dict[str, list[dict[str, Any]]],
    threshold: float,
    *,
    product_types: set[str] | None = None,
) -> ProductMatch | None:
    scored: list[tuple[str, float]] = []
    for key in title_keys:
        score = max(
            SequenceMatcher(None, query, key).ratio(),
            _token_jaccard(query, key),
        )
        if score >= threshold:
            scored.append((key, score))
    if not scored:
        return None

    scored.sort(key=lambda item: item[1], reverse=True)
    best_key, best_score = scored[0]
    if len(scored) > 1 and scored[1][1] >= best_score - 0.02:
        top_keys = [key for key, score in scored if score >= best_score - 0.02]
        candidates = _filter_product_types(
            _dedupe_by_id(
                [product for key in top_keys for product in title_index.get(key, [])]
            ),
            product_types,
        )
        if len(candidates) != 1:
            return ProductMatch(tuple(candidates), "fuzzy_title", best_score)

    candidates = _filter_product_types(
        _dedupe_by_id(title_index.get(best_key, [])),
        product_types,
    )
    if not candidates:
        return None
    if len(candidates) != 1:
        return ProductMatch(tuple(candidates), "fuzzy_title", best_score)
    return ProductMatch((candidates[0],), "fuzzy_title", best_score)


def _token_jaccard(left: str, right: str) -> float:
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def _simple_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [product for product in products if (product.get("type") or "simple") == "simple"]


def _filter_product_types(
    products: list[dict[str, Any]],
    product_types: set[str] | None,
) -> list[dict[str, Any]]:
    if product_types is None:
        return products
    return [product for product in products if (product.get("type") or "simple") in product_types]


def _dedupe_by_id(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[int] = set()
    unique: list[dict[str, Any]] = []
    for product in products:
        product_id = product.get("id")
        if not isinstance(product_id, int) or isinstance(product_id, bool):
            unique.append(product)
            continue
        if product_id in seen:
            continue
        seen.add(product_id)
        unique.append(product)
    return unique
