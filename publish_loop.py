"""Keep cloud publications running through election night without cron delivery."""

import argparse
from datetime import datetime, timedelta, timezone
import json
import subprocess
import time
from urllib.request import Request, urlopen

from app import AUTO_REFRESH_ENDS_AT, AUTO_REFRESH_INTERVAL_SECONDS, AUTO_REFRESH_STARTS_AT


def utc_now():
    return datetime.now(timezone.utc)


def published_time(site_url):
    request = Request(f"{site_url.rstrip('/')}/data/results.json?v={time.time_ns()}",
                      headers={"Cache-Control": "no-cache", "User-Agent": "Idaho Election Watch"})
    with urlopen(request, timeout=20) as response:
        fetched = json.load(response)["meta"]["fetchedAt"]
    value = datetime.fromisoformat(fetched)
    if value.tzinfo is None:
        raise ValueError("Published retrieval time has no timezone")
    return value


def dispatch_update(repository):
    # workflow_dispatch is allowed to start another workflow with GITHUB_TOKEN.
    subprocess.run(["gh", "workflow", "run", "pages.yml", "--repo", repository,
                    "--ref", "main", "--field", "automatic=true"], check=True, timeout=30)


def run(repository, site_url):
    last_attempt = None
    interval = timedelta(seconds=AUTO_REFRESH_INTERVAL_SECONDS)
    while AUTO_REFRESH_STARTS_AT <= (now := utc_now()) < AUTO_REFRESH_ENDS_AT:
        if last_attempt and now < last_attempt + interval:
            time.sleep(min((last_attempt + interval - now).total_seconds(),
                           (AUTO_REFRESH_ENDS_AT - now).total_seconds()))
            continue
        try:
            fetched = published_time(site_url)
        except (OSError, ValueError, KeyError) as error:
            print(f"::warning::Cannot read the published timestamp: {error}", flush=True)
            fetched = None
        now = utc_now()
        if now >= AUTO_REFRESH_ENDS_AT:
            break
        if fetched and now < fetched + interval:
            wake_at = min(fetched + interval, AUTO_REFRESH_ENDS_AT)
            print(f"Published data retrieved {fetched.isoformat()}; next check {wake_at.isoformat()}", flush=True)
            time.sleep((wake_at - now).total_seconds())
            continue
        last_attempt = now
        try:
            dispatch_update(repository)
            print(f"Automatic publication requested at {now.isoformat()}", flush=True)
        except (OSError, subprocess.SubprocessError) as error:
            print(f"::warning::Publication request failed; retrying in five minutes: {error}", flush=True)
    print("Outside the election-night window. Automatic publication is off.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--site-url", required=True)
    args = parser.parse_args()
    run(args.repository, args.site_url)
