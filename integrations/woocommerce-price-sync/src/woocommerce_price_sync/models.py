from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class ProductKind(StrEnum):
    SIMPLE = "simple"
    VARIABLE = "variable"
    VARIATION = "variation"


@dataclass(frozen=True)
class ExcelProduct:
    row: int
    code: str
    reference: str
    title: str
    attribute_name: str
    attribute_value: str
    price: Decimal | None
    kind: ProductKind
    stock_status: str | None = None


@dataclass(frozen=True)
class ParseIssue:
    row: int
    code: str
    title: str
    reason: str


@dataclass(frozen=True)
class WorkbookData:
    products: list[ExcelProduct]
    issues: list[ParseIssue]


@dataclass
class SyncResult:
    excel_row: int
    code: str
    title: str
    product_type: str
    attribute_name: str = ""
    attribute_value: str = ""
    match_status: str = ""
    action: str = ""
    woo_product_id: int | None = None
    woo_variation_id: int | None = None
    old_price: str = ""
    new_price: str = ""
    old_stock_status: str = ""
    new_stock_status: str = ""
    reason: str = ""


@dataclass(frozen=True)
class SyncSummary:
    mode: str
    total_rows: int
    action_counts: dict[str, int]
