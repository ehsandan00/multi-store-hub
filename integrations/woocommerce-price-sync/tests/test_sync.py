from decimal import Decimal

from woocommerce_price_sync.models import ExcelProduct, ProductKind, WorkbookData
from woocommerce_price_sync.sync import PriceSync


class FakeWooClient:
    def __init__(self, products=None, variations=None):
        self.products = products or []
        self.variations = variations or {}
        self.calls = []
        self.next_id = 900

    def list_products(self):
        self.calls.append(("list_products",))
        return self.products

    def list_variations(self, product_id):
        self.calls.append(("list_variations", product_id))
        return self.variations.get(product_id, [])

    def create_product(self, payload):
        self.calls.append(("create_product", payload))
        self.next_id += 1
        return {"id": self.next_id, **payload}

    def update_product(self, product_id, payload):
        self.calls.append(("update_product", product_id, payload))
        current = next((p for p in self.products if p["id"] == product_id), {"id": product_id})
        current.update(payload)
        return current

    def create_variation(self, product_id, payload):
        self.calls.append(("create_variation", product_id, payload))
        self.next_id += 1
        return {"id": self.next_id, **payload}

    def update_variation(self, product_id, variation_id, payload):
        self.calls.append(("update_variation", product_id, variation_id, payload))
        return {"id": variation_id, **payload}


def product(
    row,
    code,
    title,
    kind,
    price=None,
    *,
    reference="",
    attribute_name="",
    attribute_value="",
    stock_status=None,
):
    return ExcelProduct(
        row=row,
        code=code,
        reference=reference,
        title=title,
        attribute_name=attribute_name,
        attribute_value=attribute_value,
        price=Decimal(str(price)) if price is not None else None,
        kind=kind,
        stock_status=stock_status,
    )


def test_dry_run_updates_nothing_and_reports_price_change():
    client = FakeWooClient(
        products=[{"id": 10, "name": "محصول تست", "type": "simple", "regular_price": "10"}]
    )
    workbook = WorkbookData(
        products=[product(2, "S-1", "محصول تست", ProductKind.SIMPLE, 20)],
        issues=[],
    )

    results = PriceSync(client, apply=False).run(workbook)

    assert results[0].action == "would_update"
    assert results[0].old_price == "10"
    assert results[0].new_price == "20"
    assert all(call[0] not in {"create_product", "update_product"} for call in client.calls)


def test_duplicate_normalized_titles_update_all_matches():
    client = FakeWooClient(
        products=[
            {"id": 10, "name": "كالا", "type": "simple", "regular_price": "10"},
            {"id": 11, "name": "کالا", "type": "simple", "regular_price": "15"},
        ]
    )
    workbook = WorkbookData(
        products=[product(2, "S-1", "کالا", ProductKind.SIMPLE, 20)],
        issues=[],
    )

    results = PriceSync(client, apply=False).run(workbook)

    assert len(results) == 2
    assert all(result.action == "would_update" for result in results)
    assert {result.woo_product_id for result in results} == {10, 11}
    assert all(result.new_price == "20" for result in results)


def test_apply_creates_missing_simple_as_draft():
    client = FakeWooClient()
    workbook = WorkbookData(
        products=[product(2, "S-1", "New product", ProductKind.SIMPLE, 12.5)],
        issues=[],
    )

    result = PriceSync(client, apply=True).run(workbook)[0]

    assert result.action == "created"
    create_call = next(call for call in client.calls if call[0] == "create_product")
    assert create_call[1]["status"] == "draft"
    assert create_call[1]["regular_price"] == "12.5"


def test_apply_updates_and_creates_variable_children():
    parent_remote = {
        "id": 20,
        "name": "Variable",
        "type": "variable",
        "attributes": [
            {
                "id": 3,
                "name": "رنگ",
                "visible": True,
                "variation": True,
                "options": ["قرمز"],
            }
        ],
    }
    client = FakeWooClient(
        products=[parent_remote],
        variations={
            20: [
                {
                    "id": 21,
                    "regular_price": "100",
                    "attributes": [{"id": 3, "name": "رنگ", "option": "قرمز"}],
                }
            ]
        },
    )
    workbook = WorkbookData(
        products=[
            product(2, "P-1", "Variable", ProductKind.VARIABLE),
            product(
                3,
                "V-1",
                "Variable",
                ProductKind.VARIATION,
                120,
                reference="P-1",
                attribute_name="رنگ",
                attribute_value="قرمز",
            ),
            product(
                4,
                "V-2",
                "Variable",
                ProductKind.VARIATION,
                130,
                reference="P-1",
                attribute_name="رنگ",
                attribute_value="آبی",
            ),
        ],
        issues=[],
    )

    results = PriceSync(client, apply=True).run(workbook)

    assert [result.action for result in results] == ["unchanged", "updated", "created"]
    price_update = next(call for call in client.calls if call[0] == "update_variation")
    assert price_update == ("update_variation", 20, 21, {"regular_price": "120"})
    parent_update = next(call for call in client.calls if call[0] == "update_product")
    assert parent_update[2]["attributes"][0]["options"] == ["قرمز", "آبی"]
    variation_create = next(call for call in client.calls if call[0] == "create_variation")
    assert variation_create[2]["status"] == "draft"
    assert variation_create[2]["attributes"] == [{"id": 3, "option": "آبی"}]


def test_apply_converts_simple_product_to_variable_and_creates_variations():
    simple_remote = {
        "id": 30,
        "name": "Convert me",
        "type": "simple",
        "regular_price": "999",
        "sku": "P-1",
    }
    client = FakeWooClient(products=[simple_remote], variations={30: []})
    workbook = WorkbookData(
        products=[
            product(2, "P-1", "Convert me", ProductKind.VARIABLE),
            product(
                3,
                "V-1",
                "Convert me",
                ProductKind.VARIATION,
                120,
                reference="P-1",
                attribute_name="نوع",
                attribute_value="قرمز",
            ),
        ],
        issues=[],
    )

    results = PriceSync(client, apply=True).run(workbook)

    assert results[0].action == "converted"
    convert_call = next(call for call in client.calls if call[0] == "update_product")
    assert convert_call[2]["type"] == "variable"
    assert convert_call[2]["attributes"][0]["options"] == ["قرمز"]
    assert results[1].action == "created"


def test_dry_run_reports_simple_to_variable_conversion():
    client = FakeWooClient(
        products=[{"id": 30, "name": "Convert me", "type": "simple", "regular_price": "999"}]
    )
    workbook = WorkbookData(
        products=[
            product(2, "P-1", "Convert me", ProductKind.VARIABLE),
            product(
                3,
                "V-1",
                "Convert me",
                ProductKind.VARIATION,
                120,
                reference="P-1",
                attribute_name="نوع",
                attribute_value="قرمز",
            ),
        ],
        issues=[],
    )

    results = PriceSync(client, apply=False).run(workbook)

    assert results[0].action == "would_convert"
    assert results[1].action == "would_create"
    assert results[1].woo_product_id == 30


def test_apply_convert_creates_variations_on_parent_not_other_simple_products():
    client = FakeWooClient(
        products=[
            {
                "id": 30,
                "name": "Shared title",
                "type": "simple",
                "regular_price": "999",
            },
            {
                "id": 40,
                "name": "Other product",
                "type": "simple",
                "regular_price": "888",
            },
        ]
    )
    workbook = WorkbookData(
        products=[
            product(2, "P-1", "Shared title", ProductKind.VARIABLE),
            product(
                3,
                "V-1",
                "Shared title",
                ProductKind.VARIATION,
                120,
                reference="P-1",
                attribute_name="نوع",
                attribute_value="قرمز",
            ),
            product(
                4,
                "V-2",
                "Shared title",
                ProductKind.VARIATION,
                130,
                reference="P-1",
                attribute_name="نوع",
                attribute_value="آبی",
            ),
        ],
        issues=[],
    )

    results = PriceSync(client, apply=True).run(workbook)

    assert results[0].action == "converted"
    assert [result.action for result in results[1:]] == ["created", "created"]
    variation_creates = [call for call in client.calls if call[0] == "create_variation"]
    assert len(variation_creates) == 2
    assert all(call[1] == 30 for call in variation_creates)
    assert not any(call[0] == "update_product" and call[1] == 40 for call in client.calls)


def test_sync_variation_under_variable_parent_does_not_flat_match_simple():
    client = FakeWooClient(
        products=[
            {
                "id": 20,
                "name": "Shared title",
                "type": "simple",
                "regular_price": "100",
            }
        ]
    )
    workbook = WorkbookData(
        products=[
            product(2, "P-1", "Shared title", ProductKind.VARIABLE),
            product(
                3,
                "V-1",
                "Shared title",
                ProductKind.VARIATION,
                120,
                reference="P-1",
                attribute_name="نوع",
                attribute_value="قرمز",
            ),
        ],
        issues=[],
    )

    result = PriceSync(client, apply=False).run(workbook)[1]

    assert result.action == "would_create"
    assert result.woo_product_id == 20


def test_apply_updates_stock_status_from_stock_marker():
    client = FakeWooClient(
        products=[
            {
                "id": 10,
                "name": "Stocked",
                "type": "simple",
                "regular_price": "10",
                "stock_status": "instock",
            }
        ]
    )
    workbook = WorkbookData(
        products=[product(2, "S-1", "Stocked", ProductKind.SIMPLE, 10, stock_status="outofstock")],
        issues=[],
    )

    result = PriceSync(client, apply=True).run(workbook)[0]

    assert result.action == "updated"
    update_call = next(call for call in client.calls if call[0] == "update_product")
    assert update_call[2] == {"regular_price": "10", "stock_status": "outofstock"}


def test_apply_sets_instock_when_stock_marker_is_not_zero():
    client = FakeWooClient(
        products=[
            {
                "id": 10,
                "name": "Empty shelf",
                "type": "simple",
                "regular_price": "10",
                "stock_status": "outofstock",
            }
        ]
    )
    workbook = WorkbookData(
        products=[product(2, "S-1", "Empty shelf", ProductKind.SIMPLE, 10, stock_status="instock")],
        issues=[],
    )

    result = PriceSync(client, apply=True).run(workbook)[0]

    assert result.action == "updated"
    update_call = next(call for call in client.calls if call[0] == "update_product")
    assert update_call[2]["stock_status"] == "instock"


def test_stock_status_without_marker_leaves_remote_unchanged():
    client = FakeWooClient(
        products=[
            {
                "id": 10,
                "name": "No marker",
                "type": "simple",
                "regular_price": "10",
                "stock_status": "outofstock",
            }
        ]
    )
    workbook = WorkbookData(
        products=[product(2, "S-1", "No marker", ProductKind.SIMPLE, 10, stock_status=None)],
        issues=[],
    )

    result = PriceSync(client, apply=True).run(workbook)[0]

    assert result.action == "unchanged"
    assert all(call[0] != "update_product" for call in client.calls)
