from openpyxl import Workbook

from woocommerce_price_sync.excel import read_products
from woocommerce_price_sync.excel_fix import fix_excel_file
from woocommerce_price_sync.models import ProductKind


def test_fixes_missing_code_and_duplicate_sku(tmp_path):
    source = tmp_path / "broken.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(
        [
            "کد کالا",
            "شناسه کالا",
            "نام کالا",
            "تنوع",
            "مقدار تنوع",
            "موجودی",
            "موجود می باشد",
            "قیمت",
        ]
    )
    sheet.append(["P-ROOT", None, "Root", None, None, None, None, None])
    sheet.append(["PC-1", "P-ROOT", "Shared", "نوع", "دکانت", 1, "فعال", 100])
    sheet.append(["PC-1", None, "Shared parent", None, None, None, None, None])
    sheet.append(["PC-2", "PC-1", "Shared parent", "نوع", "اورجینال", 1, "فعال", 200])
    sheet.append([None, "PC-9", "Simple moved", None, None, 1, "فعال", 50])
    sheet.append(["PC-1", None, "Junk duplicate", None, None, None, None, None])
    workbook.save(source)

    output = tmp_path / "clean.xlsx"
    report = fix_excel_file(source, output)
    data = read_products(output)

    codes = {product.code for product in data.products}
    assert len(codes) == len(data.products)
    assert report.removed_rows >= 1
    assert report.code_fixes == 1
    assert any(product.code == "PC-9" for product in data.products)
    parent = next(product for product in data.products if product.code == "PC-1")
    assert parent.kind == ProductKind.VARIABLE
    variation_codes = [product.code for product in data.products if product.kind == ProductKind.VARIATION]
    assert parent.code not in variation_codes
    assert len(variation_codes) == 2
    assert len({product.code for product in data.products}) == len(data.products)
