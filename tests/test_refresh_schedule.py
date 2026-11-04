from datetime import datetime, timedelta, timezone
from http.client import HTTPConnection
import json
import threading
import unittest
from unittest.mock import patch

import app
import publish_loop


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
    def test_cloud_loop_publishes_repeatedly_without_cron_and_stops_at_cutoff(self):
        now = datetime(2026, 11, 4, 7, 49, tzinfo=timezone.utc)
        published = now - timedelta(minutes=10)
        calls = []

        def sleep(seconds):
            nonlocal now
            now += timedelta(seconds=seconds)

        def dispatch(repository):
            nonlocal now, published
            calls.append((repository, now))
            now += timedelta(seconds=20)
            published = now

        with patch("publish_loop.utc_now", side_effect=lambda: now), \
                patch("publish_loop.time.sleep", side_effect=sleep), \
                patch("publish_loop.published_time", side_effect=lambda url: published), \
                patch("publish_loop.dispatch_update", side_effect=dispatch), patch("builtins.print"):
            publish_loop.run("owner/repo", "https://example.com/watch/")
        self.assertEqual([when.isoformat() for _, when in calls], [
            "2026-11-04T07:49:00+00:00", "2026-11-04T07:54:20+00:00", "2026-11-04T07:59:40+00:00"])
        self.assertEqual(now, app.AUTO_REFRESH_ENDS_AT)

    def test_cloud_loop_does_nothing_outside_election_night(self):
        for when in ("2026-11-04T03:59:59+00:00", "2026-11-04T08:00:00+00:00",
                     "2026-11-05T04:00:00+00:00"):
            with self.subTest(when=when), patch("publish_loop.utc_now", return_value=datetime.fromisoformat(when)), \
                    patch("publish_loop.published_time") as read, patch("publish_loop.dispatch_update") as dispatch, \
                    patch("builtins.print"):
                publish_loop.run("owner/repo", "https://example.com/watch/")
            read.assert_not_called()
            dispatch.assert_not_called()

    def test_cloud_dispatch_is_marked_automatic_so_late_jobs_cannot_bypass_cutoff(self):
        with patch("publish_loop.subprocess.run") as command:
            publish_loop.dispatch_update("owner/repo")
        arguments = command.call_args.args[0]
        self.assertIn("automatic=true", arguments)
        self.assertIn("owner/repo", arguments)

    def test_cloud_loop_retries_service_errors_without_hammering_or_missing_cutoff(self):
        now = datetime(2026, 11, 4, 7, 49, tzinfo=timezone.utc)
        calls = []

        def sleep(seconds):
            nonlocal now
            now += timedelta(seconds=seconds)

        def dispatch(repository):
            calls.append(now)
            if len(calls) == 1:
                raise OSError("GitHub unavailable")

        with patch("publish_loop.utc_now", side_effect=lambda: now), \
                patch("publish_loop.time.sleep", side_effect=sleep), \
                patch("publish_loop.published_time", side_effect=OSError("Snapshot unavailable")), \
                patch("publish_loop.dispatch_update", side_effect=dispatch), patch("builtins.print"):
            publish_loop.run("owner/repo", "https://example.com/watch/")
        self.assertEqual([time.minute for time in calls], [49, 54, 59])
        self.assertEqual(now, app.AUTO_REFRESH_ENDS_AT)

    def test_cloud_loop_rechecks_cutoff_after_a_slow_network_read(self):
        with patch("publish_loop.utc_now", side_effect=[
                datetime(2026, 11, 4, 7, 59, 59, tzinfo=timezone.utc),
                datetime(2026, 11, 4, 8, 0, 1, tzinfo=timezone.utc)]), \
                patch("publish_loop.published_time", return_value=app.AUTO_REFRESH_STARTS_AT), \
                patch("publish_loop.dispatch_update") as dispatch, patch("builtins.print"):
            publish_loop.run("owner/repo", "https://example.com/watch/")
        dispatch.assert_not_called()

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

    def test_automatic_loop_stops_at_one_am_and_stays_stopped_on_relaunch(self):
        for when in ("2026-11-04T08:00:00+00:00", "2026-11-04T12:00:00+00:00",
                     "2026-11-05T04:00:00+00:00"):
            with self.subTest(when=when):
                store, stop = RecordingStore(), StopAfterWaits(1)
                with patch("app.datetime") as clock:
                    clock.now.return_value = datetime.fromisoformat(when)
                    app.update_loop(store, stop)
                self.assertEqual(store.requests, [])
                self.assertEqual(stop.waits, [])

    def test_loop_crossing_cutoff_makes_no_further_requests(self):
        store, stop = RecordingStore(), StopAfterWaits(2)
        with patch("app.datetime") as clock:
            clock.now.side_effect = [datetime(2026, 11, 4, 7, 59, tzinfo=timezone.utc),
                                    datetime(2026, 11, 4, 8, 4, tzinfo=timezone.utc)]
            clock.fromisoformat.side_effect = datetime.fromisoformat
            app.update_loop(store, stop)
        self.assertEqual(store.requests, ["finance", "results"])
        self.assertEqual(stop.waits, [300])

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
            self.assertEqual(datetime.fromisoformat(data["meta"]["autoRefreshEndsAt"]),
                             datetime(2026, 11, 4, 8, 0, tzinfo=timezone.utc))
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
