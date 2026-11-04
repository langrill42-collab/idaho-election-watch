"""Build a GitHub Pages edition from public election data, without desktop preferences."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import geometry, refresh_sources, scheduled_snapshot
from election_data import DATA, ROOT, ElectionStore, read_json, write_json


def snapshot_order(snapshot):
    meta = snapshot["meta"]
    return tuple(datetime.fromisoformat(meta.get(key) or "0001-01-01T00:00:00+00:00")
                 for key in ("sourceUpdatedAt", "fetchedAt"))


def restore_published(site_url):
    # Recover deployed results if the cache was evicted, or an unpublished fetch if deployment failed.
    stamp = int(datetime.now(timezone.utc).timestamp())
    request = Request(f"{site_url.rstrip('/')}/data/results.json?v={stamp}",
                      headers={"Cache-Control": "no-cache", "User-Agent": "Idaho Election Watch"})
    try:
        with urlopen(request, timeout=40) as response:
            previous = json.loads(response.read())
    except HTTPError as error:
        if error.code == 404:
            return
        raise
    if previous.get("meta", {}).get("electionDate") != "2026-11-03" or len(
            [race for race in previous.get("races", []) if race.get("category") == "legislature"]) != 105:
        raise ValueError("Published results are incomplete; leaving the existing site in place.")
    cached = read_json(DATA / "current.json")
    if not cached or snapshot_order(previous) > snapshot_order(cached):
        write_json(DATA / "current.json", previous)


def export_site(output, snapshot):
    output.mkdir(parents=True, exist_ok=False)
    shutil.copytree(ROOT / "static", output / "static", ignore=shutil.ignore_patterns("index.html"))
    html = (ROOT / "static/index.html").read_text().replace('<html lang="en">', '<html lang="en" data-hosting="published">')
    html = html.replace("On this Mac", "Public election watch")
    html = html.replace("Connecting to Idaho Secretary of State…", "Loading published results…")
    html = html.replace("</head>", '  <link rel="stylesheet" href="./static/published.css">\n</head>')
    for asset in ("vendor/leaflet.css", "vendor/leaflet.js", "styles.css", "published.css", "app.js"):
        version = hashlib.sha256((ROOT / "static" / asset).read_bytes()).hexdigest()[:12]
        html = html.replace(f'="./static/{asset}"', f'="./static/{asset}?v={version}"')
    (output / "index.html").write_text(html)
    (output / ".nojekyll").touch()
    public = scheduled_snapshot({"meta": snapshot["meta"], "races": snapshot["races"]})
    write_json(output / "data/results.json", public)
    write_json(output / "data/geometry.json", geometry())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "_site", help="New directory for the static site")
    parser.add_argument("--refresh", action="store_true", help="Refresh sources if polls have closed and five minutes have elapsed")
    parser.add_argument("--previous-site", help="Restore the last published snapshot before refreshing")
    args = parser.parse_args()
    for name in ("current.json", "finance.json"):
        target = DATA / name
        if not target.exists():
            shutil.copyfile(DATA / "seed" / name, target)
    if args.previous_site:
        restore_published(args.previous_site)
    store = ElectionStore()
    if args.refresh:
        refresh_sources(store, datetime.now(timezone.utc))
    export_site(args.output, store.get())
    print(f"Election Watch site written to {args.output}")


if __name__ == "__main__":
    main()
