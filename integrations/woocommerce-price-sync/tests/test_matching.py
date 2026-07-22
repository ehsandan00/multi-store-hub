from woocommerce_price_sync.matching import ProductIndex, attribute_pair_matches, fuzzy_ratio
from woocommerce_price_sync.models import ExcelProduct, ProductKind, WorkbookData
from woocommerce_price_sync.sync import PriceSync
from tests.test_sync import FakeWooClient, product


def test_product_index_ignores_sku_and_matches_by_fuzzy_title():
    remote = [{"id": 10, "name": "Site title", "type": "simple", "sku": "PC-100", "regular_price": "10"}]
    index = ProductIndex(remote)
    excel = ExcelProduct(
        row=2,
        code="PC-100",
        reference="",
        title="Excel title",
        attribute_name="",
        attribute_value="",
        price=None,
        kind=ProductKind.SIMPLE,
    )

    match = index.find(excel)

    assert match.method == "none"
    assert not match.candidates


def test_product_index_fuzzy_matches_close_titles():
    remote = [{"id": 11, "name": "کرم مرطوب کننده پوست", "type": "simple", "sku": "", "regular_price": "10"}]
    index = ProductIndex(remote, fuzzy_threshold=0.85)
    excel = ExcelProduct(
        row=2,
        code="S-1",
        reference="",
        title="کرم مرطوب‌کننده پوست",
        attribute_name="",
        attribute_value="",
        price=None,
        kind=ProductKind.SIMPLE,
    )

    match = index.find(excel)

    assert match.method == "fuzzy_title"
    assert match.candidates[0]["id"] == 11


def test_find_variation_matches_title_plus_attribute_value():
    remote = [{"id": 20, "name": "Product قرمز", "type": "simple", "sku": "VPP-1", "regular_price": "100"}]
    index = ProductIndex(remote)
    variation = ExcelProduct(
        row=3,
        code="PC-1",
        reference="P-1",
        title="Product",
        attribute_name="نوع",
        attribute_value="قرمز",
        price=None,
        kind=ProductKind.VARIATION,
    )

    match = index.find_variation(variation)

    assert match.method in {"fuzzy_title_variation", "exact_title_variation"}
    assert match.candidates[0]["id"] == 20


def test_find_variation_falls_back_to_shared_title():
    remote = [{"id": 20, "name": "Product", "type": "simple", "sku": "VPP-1", "regular_price": "100"}]
    index = ProductIndex(remote)
    variation = ExcelProduct(
        row=3,
        code="PC-1",
        reference="P-1",
        title="Product",
        attribute_name="نوع",
        attribute_value="قرمز",
        price=None,
        kind=ProductKind.VARIATION,
    )

    match = index.find_variation(variation)

    assert match.method == "exact_title"
    assert match.candidates[0]["id"] == 20


def test_sync_matches_by_title_not_sku():
    client = FakeWooClient(
        products=[
            {
                "id": 10,
                "name": "Excel title",
                "type": "simple",
                "sku": "VPP-999",
                "regular_price": "10",
            }
        ]
    )
    workbook = WorkbookData(
        products=[product(2, "PC-55", "Excel title", ProductKind.SIMPLE, 20)],
        issues=[],
    )

    result = PriceSync(client, apply=False).run(workbook)[0]

    assert result.action == "would_update"
    assert "title" in result.reason.lower()


def test_fuzzy_ratio_handles_punctuation():
    assert fuzzy_ratio("abc-def", "abc def") >= 0.85


def test_attribute_pair_matches_with_small_differences():
    from decimal import Decimal

    child = ExcelProduct(
        row=2,
        code="V-1",
        reference="P-1",
        title="Parent",
        attribute_name="رنگ",
        attribute_value="قرمز",
        price=Decimal("10"),
        kind=ProductKind.VARIATION,
    )

    assert attribute_pair_matches("رنگ", "قرمز", child, threshold=0.9)
    assert attribute_pair_matches("رنگ ", "قرمز", child, threshold=0.9)
