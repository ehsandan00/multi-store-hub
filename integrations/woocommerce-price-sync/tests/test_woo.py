from woocommerce_price_sync.config import Settings
from woocommerce_price_sync.woo import WooCommerceClient


class FakeResponse:
    def __init__(self, status_code, payload, headers=None):
        self.status_code = status_code
        self.payload = payload
        self.headers = headers or {}
        self.text = ""

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.auth = None
        self.headers = {}

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)


def settings(max_retries=2):
    return Settings(
        base_url="https://shop.example",
        consumer_key="ck_test",
        consumer_secret="cs_test",
        max_retries=max_retries,
    )


def test_paginates_products_until_short_page():
    session = FakeSession(
        [
            FakeResponse(200, [{"id": index} for index in range(100)]),
            FakeResponse(200, [{"id": 100}]),
        ]
    )
    client = WooCommerceClient(settings(), session=session)

    products = client.list_products()

    assert len(products) == 101
    assert [call[2]["params"]["page"] for call in session.calls] == [1, 2]
    assert session.auth == ("ck_test", "cs_test")


def test_retries_server_error(monkeypatch):
    monkeypatch.setattr("woocommerce_price_sync.woo.time.sleep", lambda _delay: None)
    session = FakeSession(
        [
            FakeResponse(503, {"code": "busy", "message": "Try later"}),
            FakeResponse(200, []),
        ]
    )
    client = WooCommerceClient(settings(max_retries=2), session=session)

    assert client.list_products() == []
    assert len(session.calls) == 2
