from datetime import datetime, timezone
from http.client import HTTPConnection
import json
import threading
import unittest
from unittest.mock import patch

import app


class StopAfterWaits:
    def __init__(self, count):
        self.count = count
        self.waits = []

    def is_set(self):
        return len(self.waits) >= self.count

    def wait(self, seconds):
        self.waits.append(seconds)
        return self.is_set()


class RecordingStore:
    def __init__(self):
        self.finance = {"fetchedAt": None}
        self.requests = []
        self.snapshot = {"meta": {"fetchedAt": "2026-11-04T02:00:00+00:00"}, "races": []}

    def get(self):
        return self.snapshot

    def refresh_finance(self):
        self.requests.append("finance")
        self.finance["fetchedAt"] = "2026-11-04T04:00:00+00:00"

    def refresh(self):
        self.requests.append("results")
        return self.snapshot


class RefreshScheduleTests(unittest.TestCase):
    def test_no_automatic_requests_before_statewide_poll_close(self):
        for hour, minute in ((2, 0), (3, 30), (3, 59)):
            with self.subTest(hour=hour, minute=minute):
                store, stop = RecordingStore(), StopAfterWaits(1)
                with patch("app.datetime") as clock:
                    clock.now.return_value = datetime(2026, 11, 4, hour, minute, tzinfo=timezone.utc)
                    clock.fromisoformat.side_effect = datetime.fromisoformat
                    app.update_loop(store, stop)
                self.assertEqual(store.requests, [])

    def test_first_refresh_at_close_then_five_minute_spacing(self):
        store, stop = RecordingStore(), StopAfterWaits(3)
        with patch("app.datetime") as clock:
            clock.now.side_effect = [datetime(2026, 11, 4, 3, 59, 59, tzinfo=timezone.utc),
                                     datetime(2026, 11, 4, 4, 0, tzinfo=timezone.utc),
                                     datetime(2026, 11, 4, 4, 5, tzinfo=timezone.utc)]
            clock.fromisoformat.side_effect = datetime.fromisoformat
            app.update_loop(store, stop)
        self.assertEqual(stop.waits, [1, 300, 300])
        self.assertEqual(store.requests, ["finance", "results", "results"])

    def test_opening_data_uses_cache_and_manual_refresh_remains_available(self):
        store = RecordingStore()
        with patch("app.PORT", 0):
            server = app.create_server(store)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
        try:
            connection.request("GET", "/api/data")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            self.assertEqual(store.requests, [])
            self.assertEqual(data["meta"]["autoRefreshIntervalSeconds"], 300)
            self.assertEqual(datetime.fromisoformat(data["meta"]["autoRefreshStartsAt"]),
                             datetime(2026, 11, 4, 4, 0, tzinfo=timezone.utc))
            connection.request("POST", "/api/refresh")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
            self.assertEqual(store.requests, ["results"])
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
