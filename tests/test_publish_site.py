from datetime import datetime, timezone
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import app
import election_data
import publish_site
from test_refresh_schedule import RecordingStore


class PublishSiteTests(unittest.TestCase):
    def test_published_refresh_respects_close_and_minimum_interval(self):
        for when, fetched, expected in [
            ("2026-11-04T03:59:59+00:00", "2026-11-04T02:00:00+00:00", []),
            ("2026-11-04T04:00:00+00:00", "2026-11-04T02:00:00+00:00", ["finance", "results"]),
            ("2026-11-04T04:04:59+00:00", "2026-11-04T04:00:00+00:00", []),
            ("2026-11-04T07:59:59+00:00", "2026-11-04T07:50:00+00:00", ["finance", "results"]),
            ("2026-11-04T08:00:00+00:00", "2026-11-04T07:50:00+00:00", []),
            ("2026-11-05T04:00:00+00:00", "2026-11-04T07:50:00+00:00", []),
        ]:
            with self.subTest(when=when):
                store = RecordingStore()
                store.snapshot["meta"]["fetchedAt"] = fetched
                app.refresh_sources(store, datetime.fromisoformat(when))
                self.assertEqual(store.requests, expected)

    def test_manual_publication_after_cutoff_still_respects_request_spacing(self):
        for when, fetched, expected in [
            ("2026-11-04T03:59:59+00:00", "2026-11-04T02:00:00+00:00", []),
            ("2026-11-04T08:00:00+00:00", "2026-11-04T07:50:00+00:00", ["finance", "results"]),
            ("2026-11-04T08:04:59+00:00", "2026-11-04T08:00:00+00:00", []),
            ("2026-11-05T12:00:00+00:00", "2026-11-04T08:00:00+00:00", ["finance", "results"]),
        ]:
            with self.subTest(when=when):
                store = RecordingStore()
                store.snapshot["meta"]["fetchedAt"] = fetched
                app.refresh_sources(store, datetime.fromisoformat(when), manual=True)
                self.assertEqual(store.requests, expected)

    def test_publisher_cli_distinguishes_manual_and_automatic_runs_after_cutoff(self):
        for flag, expected in (("--refresh", []), ("--manual-refresh", ["finance", "results"])):
            with self.subTest(flag=flag), tempfile.TemporaryDirectory() as directory:
                data = Path(directory)
                for name in ("current.json", "finance.json"):
                    (data / name).write_text("{}")
                store = RecordingStore()
                with patch("sys.argv", ["publish_site.py", flag]), patch("publish_site.DATA", data), \
                        patch("publish_site.ElectionStore", return_value=store), \
                        patch("publish_site.export_site") as export, patch("publish_site.datetime") as clock, \
                        patch("builtins.print"):
                    clock.now.return_value = datetime(2026, 11, 4, 8, 0, tzinfo=timezone.utc)
                    publish_site.main()
                self.assertEqual(store.requests, expected)
                export.assert_called_once()

    def test_export_contains_only_web_assets_and_public_data(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            snapshot = {"meta": {"electionDate": "2026-11-03"}, "races": [], "privateNotes": "not for publishing"}
            publish_site.export_site(output, snapshot)
            html = (output / "index.html").read_text()
            self.assertIn('data-hosting="published"', html)
            self.assertNotIn('src="/static/', html)
            self.assertNotIn('href="/static/', html)
            data = json.loads((output / "data/results.json").read_text())
            self.assertEqual(set(data), {"meta", "races"})
            self.assertEqual(data["meta"]["autoRefreshIntervalSeconds"], 300)
            self.assertEqual(data["meta"]["autoRefreshEndsAt"], "2026-11-04T01:00:00-07:00")
            self.assertEqual(len(json.loads((output / "data/geometry.json").read_text())["legislative"]["features"]), 35)
            self.assertEqual({p.name for p in output.iterdir()}, {"index.html", ".nojekyll", "static", "data"})
            self.assertFalse((output / "app.py").exists())

    def test_previous_published_snapshot_is_restored_before_updating(self):
        previous = {"meta": {"electionDate": "2026-11-03", "sourceUpdatedAt": "2026-11-04T05:00:00Z"},
                    "races": [{"category": "legislature"}] * 105}
        with tempfile.TemporaryDirectory() as directory, patch("publish_site.DATA", Path(directory)):
            with patch("publish_site.urlopen") as request:
                request.return_value.__enter__.return_value.read.return_value = json.dumps(previous).encode()
                publish_site.restore_published("https://example.com/watch/")
            self.assertEqual(json.loads((Path(directory) / "current.json").read_text()), previous)

    def test_initial_missing_site_uses_seed_but_other_errors_stop_publication(self):
        with patch("publish_site.urlopen", side_effect=HTTPError("https://example.com", 404, "Not found", {}, None)):
            publish_site.restore_published("https://example.com/watch/")
        with patch("publish_site.urlopen", side_effect=HTTPError("https://example.com", 503, "Unavailable", {}, None)):
            with self.assertRaises(HTTPError):
                publish_site.restore_published("https://example.com/watch/")

    def test_fetched_snapshot_survives_failed_publication(self):
        published = json.loads((publish_site.DATA / "seed/current.json").read_text())
        published["meta"].update(sourceUpdatedAt="2026-11-04T04:00:00Z", fetchedAt="2026-11-04T04:00:10+00:00")
        for source_time in ("2026-11-04T04:00:00Z", "2026-11-04T04:05:00Z"):
            with self.subTest(source_time=source_time):
                fetched = deepcopy(published)
                fetched["meta"].update(sourceUpdatedAt=source_time, fetchedAt="2026-11-04T04:05:10+00:00")
                with tempfile.TemporaryDirectory() as directory, patch("publish_site.DATA", Path(directory)):
                    (Path(directory) / "current.json").write_text(json.dumps(fetched))
                    with patch("publish_site.urlopen") as request:
                        request.return_value.__enter__.return_value.read.return_value = json.dumps(published).encode()
                        publish_site.restore_published("https://example.com/watch/")
                    retained = json.loads((Path(directory) / "current.json").read_text())
                    self.assertEqual(retained["meta"]["fetchedAt"], "2026-11-04T04:05:10+00:00")
                    store = RecordingStore()
                    store.snapshot = retained
                    app.refresh_sources(store, datetime(2026, 11, 4, 4, 6, tzinfo=timezone.utc))
                    self.assertEqual(store.requests, [])

    def test_failed_official_fetch_exports_last_published_votes_and_error(self):
        previous = json.loads((publish_site.DATA / "seed/current.json").read_text())
        previous["meta"].update(sourceUpdatedAt="2026-11-04T04:00:00Z", fetchedAt="2026-11-04T04:00:10+00:00")
        previous["races"][0]["votes"] = 100
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            with patch("publish_site.DATA", data), patch("election_data.DATA", data):
                with patch("publish_site.urlopen") as request:
                    request.return_value.__enter__.return_value.read.return_value = json.dumps(previous).encode()
                    publish_site.restore_published("https://example.com/watch/")
                store = election_data.ElectionStore()
                store.finance["fetchedAt"] = "2026-11-04T04:20:00+00:00"
                with patch("election_data.download", side_effect=RuntimeError("Official source unavailable")) as download:
                    app.refresh_sources(store, datetime(2026, 11, 4, 4, 20, tzinfo=timezone.utc))
                download.assert_called_once_with(election_data.RESULTS_URL)
                output = Path(directory) / "site"
                publish_site.export_site(output, store.get())
                result = json.loads((output / "data/results.json").read_text())
                self.assertEqual(result["races"][0]["votes"], 100)
                self.assertEqual(result["meta"]["fetchError"], "Official source unavailable")


if __name__ == "__main__":
    unittest.main()
