"""The interactive API docs (/docs, /redoc) and raw schema (/openapi.json) - see
app/main.py's _docs_urls() and settings.enable_api_docs in app/config.py.

Security audit background: these were reachable with no login and no way to turn them
off, handing anyone the full request/response schema and a try-it-out console for every
route. Closed by default now, the same fail-closed default this app already uses for login
and cookie security (see app/auth.py) - an operator who wants them back opts in with
SHIFTFLOW_ENABLE_API_DOCS=1.
"""

import unittest

from fastapi.testclient import TestClient

from app.config import settings
from app.main import _docs_urls, app


class ApiDocsGatingTests(unittest.TestCase):
    def setUp(self):
        self._previous = settings.enable_api_docs

    def tearDown(self):
        settings.enable_api_docs = self._previous

    def test_docs_urls_helper_is_closed_by_default(self):
        settings.enable_api_docs = False
        self.assertEqual(_docs_urls(), (None, None, None))

    def test_docs_urls_helper_opens_all_three_when_enabled(self):
        settings.enable_api_docs = True
        self.assertEqual(_docs_urls(), ("/docs", "/redoc", "/openapi.json"))

    def test_docs_redoc_and_openapi_are_unreachable_on_the_real_app_by_default(self):
        """The real, already-constructed `app` - not a rebuilt one - reflects whatever
        settings.enable_api_docs was at import time. This repo's default is off, so these
        three must 404 (route not registered at all, not merely unauthorized) exactly as a
        fresh production boot would see them."""
        client = TestClient(app, base_url="https://testserver")
        self.assertEqual(client.get("/docs").status_code, 404)
        self.assertEqual(client.get("/redoc").status_code, 404)
        self.assertEqual(client.get("/openapi.json").status_code, 404)


if __name__ == "__main__":
    unittest.main()
