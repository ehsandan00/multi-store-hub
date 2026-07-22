from woocommerce_price_sync.normalization import parse_stock_status, stock_status_equal


def test_parse_stock_status_zero_is_outofstock():
    assert parse_stock_status(0) == "outofstock"
    assert parse_stock_status("0") == "outofstock"
    assert parse_stock_status(0.0) == "outofstock"


def test_parse_stock_status_non_zero_is_instock():
    assert parse_stock_status(1) == "instock"
    assert parse_stock_status("5") == "instock"
    assert parse_stock_status("") == "instock"
    assert parse_stock_status(None) == "instock"


def test_stock_status_equal():
    assert stock_status_equal("instock", "instock")
    assert stock_status_equal("", "instock")
    assert not stock_status_equal("outofstock", "instock")
