from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests

from .description_product import ProductFacts

DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[2] / "data" / "web-research-cache.json"
SEARCH_DELAY_SECONDS = 0.35
USER_AGENT = (
    "Mozilla/5.0 (compatible; WooCommerceDescriptionBot/1.0; +https://github.com/ehsandan00/multi-store-hub)"
)


def default_cache_path() -> Path:
    return DEFAULT_CACHE_PATH


def load_research_cache(path: Path | None = None) -> dict[str, dict[str, Any]]:
    cache_file = path or default_cache_path()
    if not cache_file.is_file():
        return {}
    try:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_research_cache(cache: dict[str, dict[str, Any]], path: Path | None = None) -> Path:
    cache_file = path or default_cache_path()
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    return cache_file


def _search_duckduckgo(query: str, *, timeout: float = 12.0) -> list[str]:
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
    )
    response.raise_for_status()
    snippets = re.findall(
        r'class="result__snippet"[^>]*>(.*?)</(?:a|td|div)>',
        response.text,
        flags=re.I | re.S,
    )
    cleaned: list[str] = []
    for snippet in snippets[:5]:
        text = re.sub(r"<[^>]+>", " ", snippet)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            cleaned.append(text)
    return cleaned


def research_product_title(
    title: str,
    *,
    cache: dict[str, dict[str, Any]] | None = None,
    cache_path: Path | None = None,
    use_network: bool = True,
) -> dict[str, Any]:
    store = cache if cache is not None else load_research_cache(cache_path)
    if title in store:
        return store[title]

    result: dict[str, Any] = {
        "title": title,
        "query": f"{title} product ingredients usage",
        "snippets": [],
        "brand": "",
        "form": "",
        "volume": "",
        "summary_hint": "",
    }

    if use_network:
        try:
            result["snippets"] = _search_duckduckgo(result["query"])
            time.sleep(SEARCH_DELAY_SECONDS)
        except requests.RequestException:
            result["snippets"] = []

    combined = " ".join(result["snippets"])
    latin = re.findall(r"[A-Za-z][A-Za-z0-9&.'\- ]{1,30}", title)
    if latin:
        result["brand"] = latin[-1].strip()

    volume_match = re.search(r"(\d+)\s*(میل|ml|گرم|g|عدد|caps|tablet)", title, re.I)
    if volume_match:
        result["volume"] = volume_match.group(0)

    if re.search(r"کرم|ژل|لوسیون|سرم|اسپری", title, re.I):
        result["form"] = "کرم/سرم"
    elif re.search(r"شامپو|نرم.?کننده", title, re.I):
        result["form"] = "شامپو"
    elif re.search(r"قرص|کپسول|tablet|capsule", title, re.I):
        result["form"] = "قرص/کپسول"
    elif re.search(r"عطر|ادو|perfume", title, re.I):
        result["form"] = "عطر"

    if combined:
        first = result["snippets"][0]
        if len(first) > 40:
            result["summary_hint"] = first[:280]

    if use_network or result["snippets"] or result["summary_hint"]:
        store[title] = result
    return result


def enrich_facts_from_research(facts: ProductFacts, research: dict[str, Any]) -> ProductFacts:
    if facts.title in research and not research.get("snippets") and not research.get("summary_hint"):
        return facts

    brand = facts.brand or str(research.get("brand") or "")
    form = facts.form or str(research.get("form") or "")
    volume = facts.volume or str(research.get("volume") or "")
    summary = facts.summary
    if not summary and research.get("summary_hint"):
        summary = str(research["summary_hint"])

    # Only enrich lightweight fields; never invent medical claims from snippets.
    return ProductFacts(
        title=facts.title,
        woo_product_id=facts.woo_product_id,
        code=facts.code,
        brand=brand,
        product_type=facts.product_type,
        form=form,
        volume=volume,
        count=facts.count,
        main_uses=list(facts.main_uses),
        benefits=list(facts.benefits),
        ingredients=list(facts.ingredients),
        usage_steps=list(facts.usage_steps),
        suitable_for=list(facts.suitable_for),
        cautions=list(facts.cautions),
        quick_facts=list(facts.quick_facts),
        faq=list(facts.faq),
        summary=summary,
        category_hint=facts.category_hint,
    )
