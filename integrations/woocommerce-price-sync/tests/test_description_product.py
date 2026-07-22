from woocommerce_price_sync.description_product import (
    ProductFacts,
    build_description,
    read_catalog_products,
    write_descriptions_report,
)
from woocommerce_price_sync.generate_descriptions import generate_description_for_product


def test_build_description_contains_sections(tmp_path):
    facts = ProductFacts(
        title="کرم تست",
        summary="خلاصه تست.",
        main_uses=["آبرسانی"],
        benefits=[("نرمی", "کمک به نرمی پوست")],
        ingredients=[("گلیسیرین", "5%", "—")],
        usage_steps=["روی پوست تمیز استفاده کنید."],
        suitable_for=["پوست خشک"],
        cautions=["از چشم دور نگه دارید."],
        quick_facts=[("نوع", "کرم")],
        faq=[("چند بار؟", "روزانه یک بار.")],
    )
    result = build_description(facts)
    assert "lux-beauty-infographic" in result.infographic
    assert "rose-table-block" in result.table_html
    assert "faq-lilac-block" in result.faq_html
    assert result.short_description.count("<p>") == 2
    assert result.seo_title
    assert "مزایای اسلی" in result.full_description
    assert "rose-table-block" in result.full_description
    assert "faq-lilac-block" in result.full_description


def test_generate_description_for_product():
    item = generate_description_for_product(
        "A Z مولتی ویتامین بالای 50 سال بانوان",
        code="34376",
    )
    assert item.title.startswith("A Z")
    assert "EuRho Vital" in item.infographic or "مولتی" in item.description


def test_read_catalog_products():
    from pathlib import Path

    catalog = Path(__file__).resolve().parents[1] / "data" / "catalog.xlsx"
    products = read_catalog_products(catalog)
    assert len(products) > 100


def test_write_descriptions_report(tmp_path):
    item = generate_description_for_product("کرم تست", code="T1")
    path = tmp_path / "descriptions-report.xlsx"
    write_descriptions_report(path, [item])
    assert path.is_file()
