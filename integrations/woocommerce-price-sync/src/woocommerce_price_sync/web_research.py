from __future__ import annotations

import json
import re
import time
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests

from .description_product import ProductFacts

_CACHE_VERSION = 1
_DEFAULT_CACHE = Path(__file__).resolve().parents[2] / "data" / "web-research-cache.json"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
_REQUEST_TIMEOUT = 12
_MIN_INTERVAL_SEC = 0.6


class WebResearchCache:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or _DEFAULT_CACHE
        self._data: dict[str, Any] = {"version": _CACHE_VERSION, "entries": {}}
        self._loaded = False
        self._last_request_at = 0.0

    def load(self) -> None:
        if self._loaded:
            return
        if self.path.is_file():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(raw, dict) and raw.get("version") == _CACHE_VERSION:
                    self._data = raw
            except (json.JSONDecodeError, OSError):
                pass
        self._loaded = True

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get(self, key: str) -> dict[str, Any] | None:
        self.load()
        entry = self._data["entries"].get(key)
        return entry if isinstance(entry, dict) else None

    def set(self, key: str, value: dict[str, Any]) -> None:
        self.load()
        self._data["entries"][key] = value

    def throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < _MIN_INTERVAL_SEC:
            time.sleep(_MIN_INTERVAL_SEC - elapsed)
        self._last_request_at = time.monotonic()


def _strip_html(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = unescape(cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _search_duckduckgo(query: str, cache: WebResearchCache) -> list[str]:
    cache.throttle()
    response = requests.post(
        "https://html.duckduckgo.com/html/",
        data={"q": query, "b": ""},
        headers={"User-Agent": _USER_AGENT},
        timeout=_REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    snippets: list[str] = []
    for match in re.finditer(
        r'class="result__snippet"[^>]*>(.*?)</(?:a|span|div)>',
        response.text,
        flags=re.I | re.S,
    ):
        snippet = _strip_html(match.group(1))
        if snippet and len(snippet) > 30:
            snippets.append(snippet)
    if not snippets:
        for match in re.finditer(r'class="result__body"[^>]*>(.*?)</div>', response.text, flags=re.I | re.S):
            snippet = _strip_html(match.group(1))
            if snippet and len(snippet) > 30:
                snippets.append(snippet)
    return snippets[:5]


def research_product_snippets(title: str, *, cache: WebResearchCache | None = None) -> list[str]:
    cache = cache or WebResearchCache()
    cache_key = title.strip().casefold()
    cached = cache.get(cache_key)
    if cached is not None:
        return list(cached.get("snippets") or [])

    brand_match = re.findall(r"[A-Za-z][A-Za-z0-9&.'\- ]{1,30}", title)
    brand = brand_match[-1].strip() if brand_match else ""
    queries = [f"{title} benefits ingredients usage"]
    if brand and brand.lower() not in title.lower():
        queries.append(f"{brand} {title}")

    snippets: list[str] = []
    seen: set[str] = set()
    for query in queries:
        try:
            for snippet in _search_duckduckgo(query, cache):
                key = snippet.casefold()
                if key not in seen:
                    seen.add(key)
                    snippets.append(snippet)
        except requests.RequestException:
            continue
        if len(snippets) >= 4:
            break

    cache.set(cache_key, {"snippets": snippets})
    cache.save()
    return snippets


def _persian_digits_to_ascii(text: str) -> str:
    table = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
    return text.translate(table)


def _extract_volume(title: str, snippets: list[str]) -> str:
    combined = _persian_digits_to_ascii(f"{title} {' '.join(snippets)}")
    match = re.search(r"(\d+)\s*(ml|میل|میلی\s*لیتر|g|گرم|عدد|caps|tablet)", combined, re.I)
    return match.group(0).strip() if match else ""


def _extract_benefit_phrases(snippets: list[str]) -> list[tuple[str, str]]:
    benefit_keywords = [
        ("آبرسانی", "کمک به حفظ رطوبت و نرمی پوست."),
        ("مرطوب", "پشتیبانی از رطوبت طبیعی پوست."),
        ("ضد چروک", "کمک به کاهش ظاهر خطوط ریز."),
        ("آنتی‌اکسیدان", "محافظت در برابر استرس اکسیداتیو."),
        ("antioxidant", "محافظت در برابر استرس اکسیداتیو."),
        ("ویتامین", "تأمین ریزمغذی‌های مورد نیاز."),
        ("vitamin", "تأمین ریزمغذی‌های مورد نیاز."),
        ("ضد آفتاب", "محافظت در برابر اشعه UV."),
        ("پاکسازی", "پاک‌سازی ملایم ناخالصی‌ها."),
        ("درخشندگی", "افزایش شفافیت و درخشش پوست."),
        ("مو", "مراقبت و تقویت ساختار مو."),
        ("عطر", "رایحه‌ای ماندگار و جذاب."),
        ("hyaluronic", "آبرسانی عمیق با هیالورونیک اسید."),
        ("retinol", "کمک به بازسازی و جوانسازی پوست."),
        ("niacinamide", "تنظیم چربی و یکنواخت‌سازی رنگ پوست."),
        ("collagen", "پشتیبانی از استحکام و الاستیسیته."),
    ]
    text = " ".join(snippets).casefold()
    benefits: list[tuple[str, str]] = []
    for keyword, description in benefit_keywords:
        if keyword.casefold() in text or keyword in text:
            benefits.append((keyword.replace("hyaluronic", "هیالورونیک اسید"), description))
        if len(benefits) >= 4:
            break
    return benefits


def _build_summary_from_snippets(title: str, snippets: list[str], product_type: str) -> str:
    if not snippets:
        return ""
    lead = snippets[0]
    lead = re.sub(r"\s+", " ", lead)
    if len(lead) > 260:
        lead = lead[:257].rsplit(" ", 1)[0] + "…"
    if title.split()[0] in lead:
        return lead
    return f"{title}؛ {lead}"


def _build_faq_from_context(title: str, product_type: str, usage_steps: list[str]) -> list[tuple[str, str]]:
    faq: list[tuple[str, str]] = []
    if usage_steps:
        faq.append(("روش استفاده چگونه است؟", usage_steps[0]))
    if product_type == "عطر":
        faq.extend(
            [
                ("ماندگاری عطر چقدر است؟", "بسته به نوع پوست و آب‌وهوا متفاوت است؛ معمولاً چند ساعت تا یک روز."),
                ("روی چه نقاطی اسپری شود؟", "نقاط نبض مانند مچ، گردن و پشت گوش مناسب‌ترند."),
            ]
        )
    elif product_type == "مکمل غذایی":
        faq.extend(
            [
                ("آیا نیاز به مشورت پزشک دارد؟", "در بارداری، شیردهی یا مصرف دارو با پزشک مشورت کنید."),
                ("بهترین زمان مصرف چه موقع است؟", "معمولاً همراه غذا و طبق دستور روی بسته‌بندی."),
            ]
        )
    else:
        faq.extend(
            [
                ("برای چه نوع پوستی مناسب است؟", "بسته به نوع محصول؛ قبل از خرید نوع پوست خود را در نظر بگیرید."),
                ("آیا زیر آرایش قابل استفاده است؟", "پس از جذب کامل، در بسیاری از فرمول‌ها زیر آرایش نیز مناسب است."),
            ]
        )
    faq.append((f"خرید {title} اصل از کجا؟", "از فروشگاه‌های معتبر و دارای ضمانت اصالت کالا تهیه کنید."))
    return faq[:5]


def purge_empty_cache_entries(cache: WebResearchCache) -> int:
    cache.load()
    entries = cache._data.get("entries", {})
    removed = 0
    for key in list(entries):
        snippets = entries[key].get("snippets") if isinstance(entries[key], dict) else None
        if not snippets:
            del entries[key]
            removed += 1
    if removed:
        cache.save()
    return removed


def enrich_facts_from_web(
    facts: ProductFacts,
    *,
    cache: WebResearchCache | None = None,
    enabled: bool = True,
) -> ProductFacts:
    if not enabled or facts.title in {"کرم تست"}:
        return facts

    snippets = research_product_snippets(facts.title, cache=cache)
    if not snippets:
        return facts

    volume = facts.volume or _extract_volume(facts.title, snippets)
    summary = facts.summary
    if snippets and (not summary or summary.startswith(facts.title)):
        summary = _build_summary_from_snippets(facts.title, snippets, facts.product_type)
    benefits = list(facts.benefits)
    if len(benefits) < 3:
        web_benefits = _extract_benefit_phrases(snippets)
        seen = {title for title, _ in benefits}
        for title, body in web_benefits:
            if title not in seen:
                benefits.append((title, body))
                seen.add(title)

    usage_steps = list(facts.usage_steps)
    faq = list(facts.faq) or _build_faq_from_context(facts.title, facts.product_type, usage_steps)

    notes = "web-researched" if snippets else facts.category_hint
    return ProductFacts(
        title=facts.title,
        woo_product_id=facts.woo_product_id,
        code=facts.code,
        brand=facts.brand,
        product_type=facts.product_type,
        form=facts.form,
        volume=volume,
        count=facts.count,
        main_uses=facts.main_uses,
        benefits=benefits[:6],
        ingredients=facts.ingredients,
        usage_steps=usage_steps,
        suitable_for=facts.suitable_for,
        cautions=facts.cautions,
        quick_facts=facts.quick_facts,
        faq=faq,
        summary=summary,
        category_hint=notes,
    )
