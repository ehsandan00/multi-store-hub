from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

_ARABIC_TO_PERSIAN = str.maketrans(
    {
        "\u064a": "\u06cc",  # Arabic yeh -> Persian yeh
        "\u0649": "\u06cc",  # alef maksura -> Persian yeh
        "\u0643": "\u06a9",  # Arabic kaf -> Persian kaf
    }
)
_ZERO_WIDTH = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")
_WHITESPACE = re.compile(r"\s+")


def normalize_text(value: object) -> str:
    """Normalize safely without removing meaningful words or punctuation."""
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(_ARABIC_TO_PERSIAN)
    text = _ZERO_WIDTH.sub("", text)
    return _WHITESPACE.sub(" ", text).strip().casefold()


def parse_price(value: object) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    raw = str(value).strip().replace(",", "")
    try:
        price = Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError(f'Invalid price "{value}"') from exc
    if not price.is_finite() or price < 0:
        raise ValueError(f'Invalid price "{value}"')
    return price


def decimal_to_string(value: Decimal | object | None) -> str:
    if value is None or str(value).strip() == "":
        return ""
    price = value if isinstance(value, Decimal) else parse_price(value)
    if price is None:
        return ""
    rendered = format(price, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered or "0"


def prices_equal(left: object, right: Decimal) -> bool:
    try:
        parsed = parse_price(left)
    except ValueError:
        return False
    return parsed == right


def parse_stock_status(value: object) -> str:
    """Map the Excel stock? marker to WooCommerce stock_status."""
    if value is None:
        return "instock"
    if isinstance(value, bool):
        return "outofstock" if value is False else "instock"
    if isinstance(value, (int, float)):
        return "outofstock" if value == 0 else "instock"
    text = str(value).strip()
    if not text:
        return "instock"
    if text == "0":
        return "outofstock"
    try:
        if float(text.replace(",", "")) == 0:
            return "outofstock"
    except ValueError:
        pass
    return "instock"


def stock_status_equal(left: object, right: str) -> bool:
    if left in (None, ""):
        return right == "instock"
    return str(left).strip().casefold() == right.casefold()
