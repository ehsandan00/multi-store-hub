from unittest.mock import patch

from woocommerce_price_sync.generate_descriptions import generate_description_for_product
from woocommerce_price_sync.web_research import enrich_facts_from_web
from woocommerce_price_sync.description_product import ProductFacts


def test_generate_description_for_product():
    item = generate_description_for_product(
        "A Z مولتی ویتامین بالای 50 سال بانوان",
        code="34376",
        web_search=False,
    )
    assert item.title.startswith("A Z")
    assert "EuRho Vital" in item.infographic or "مولتی" in item.description


def test_enrich_facts_from_web_uses_cache(tmp_path):
    cache_path = tmp_path / "cache.json"
    facts = ProductFacts(
        title="Test Serum Vitamin C",
        product_type="مراقبت پوست",
        form="سرم",
        brand="TestBrand",
        usage_steps=["روی پوست تمیز استفاده کنید."],
    )
    with patch(
        "woocommerce_price_sync.web_research.research_product_snippets",
        return_value=["Vitamin C serum helps brighten skin and provides antioxidant support."],
    ):
        enriched = enrich_facts_from_web(facts, cache=__import__("woocommerce_price_sync.web_research", fromlist=["WebResearchCache"]).WebResearchCache(cache_path))
    assert enriched.summary
    assert enriched.benefits


def test_generate_description_long_has_geo_aeo_blocks():
    item = generate_description_for_product(
        "Baccarat Rouge 540 باکارات رژ",
        code="PC-6963",
        web_search=False,
    )
    assert "خرید آنلاین" in item.description
    assert "پرسش‌های رایج" in item.description
