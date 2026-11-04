from collections import defaultdict
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import re
import subprocess
import threading
import unicodedata

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RESULTS_URL = "https://results.voteidaho.gov/cdn/results/id/export-nov2026.json"
RESULTS_PAGE = "https://results.voteidaho.gov/results/public/id/elections/nov2026"
HISTORY_URL = "https://archive.sos.idaho.gov/elections/data/results/{year}/raw_races_general.xlsx"
FINANCE_URL = "https://api-sunshine.voteidaho.gov/api/PublicFilerDetails/GetCandidateDetails"
FINANCE_PAGE = "https://sunshine.voteidaho.gov/campaignfinance/"
STATE_IDS = {"ussen", "gov", "ltgov", "sos", "sco", "sto", "ag", "spi", "hjr4", "hjr6", "prop1", "gun"}
STATE_OFFICES = {"United States Senator", "Governor", "Lieutenant Governor", "Secretary of State",
                 "State Controller", "State Treasurer", "Attorney General", "Superintendent of Public Instruction"}
FINANCE_FIELDS = ("guid", "filerStatusCode", "firstName", "middleName", "lastName", "firstNameLastName",
                  "firstMiddleLastName", "committeeName", "electionYear", "office", "cityDistrict", "seatZone",
                  "jurisdiction", "politicalPartyCode", "totalRaised", "totalSpent", "balanceOfFunds")
FINANCE_ALIASES = json.loads((DATA / "finance-aliases.json").read_text())


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    temp.replace(path)


def download(url, body=None):
    # macOS curl uses the machine's certificate trust configuration.
    args = ["/usr/bin/curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "40",
            "--user-agent", "Mozilla/5.0 (Idaho Election Watch; local desktop)", url]
    if body is not None:
        args += ["--header", "Content-Type: application/json", "--data-binary", "@-"]
    result = subprocess.run(args, input=json.dumps(body).encode() if body is not None else None,
                            capture_output=True, timeout=45, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace").strip())
    return result.stdout


def normalized_name(value):
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", value))


def office_matches(race, registration):
    if str(registration.get("electionYear")) != "2026":
        return False
    office = registration.get("office")
    district = registration.get("cityDistrict") or ""
    seat = str(registration.get("seatZone") or "").upper()
    if race["category"] == "legislature":
        if district != f"Legislative District {race['district']}":
            return False
        if race["chamber"] == "senate":
            return office == "State Senator"
        return office == "State Representative" and seat == race["chamber"][-1].upper()
    if race["category"] == "statewide":
        return office == race["name"]
    name = race["name"]
    if "College of Western Idaho Trustee Zone" in name:
        return office == "College Trustee" and district == "College of Western Idaho" and seat == name.rsplit(" ", 1)[-1]
    if "Highway District Commissioner Zone" in name:
        return office == "Highway Commissioner" and district == "Ada County Highway" and seat == name.rsplit(" ", 1)[-1]
    if "County Commissioner District" in name:
        return office == "County Commissioner" and district == "Ada County" and seat == name.rsplit(" ", 1)[-1]
    local_offices = {"Clerk of the District Court": "Clerk", "County Treasurer": "County Treasurer",
                     "County Assessor": "Assessor", "County Coroner": "Coroner"}
    return office == local_offices.get(name, "__no_match__") and district == "Ada County"


def match_finance(race, candidate, registrations):
    name = normalized_name(candidate["name"])
    reviewed_guid = FINANCE_ALIASES.get(f"{race['id']}|{candidate['name']}")
    matches = []
    for reg in registrations:
        if not office_matches(race, reg):
            continue
        names = {normalized_name(reg.get(k)) for k in ("firstNameLastName", "firstMiddleLastName")}
        tokens = name.split()
        same_first_last = (len(tokens) >= 2 and tokens[0] == normalized_name(reg.get("firstName"))
                           and tokens[-1] == normalized_name(reg.get("lastName")))
        committee_match = (normalized_name(reg.get("lastName")) in tokens and
                           f" {name} " in f" {normalized_name(reg.get('committeeName'))} ")
        if name in names or same_first_last or committee_match or (reviewed_guid is not None and reg.get("guid") == reviewed_guid):
            matches.append(reg)
    active = [reg for reg in matches if reg.get("filerStatusCode") == "FACT"]
    if active:
        matches = active
    if len(matches) != 1:
        return None
    reg = matches[0]
    return {"raised": reg.get("totalRaised"), "spent": reg.get("totalSpent"),
            "cashOnHand": reg.get("balanceOfFunds"), "reportStart": None, "reportEnd": None,
            "sourceUrl": "https://sunshine.voteidaho.gov/public/cf/candidateprofile?guid=" + reg["guid"] + "&tabName=CAN&isLegacy=false",
            "note": "Sunshine reported totals for this 2026 registration, not a single monthly reporting period. Cash balance may include carry-in. Independent expenditures are not included."}


def aggregate_history(rows, year):
    grouped = defaultdict(lambda: defaultdict(int))
    for county, precinct, race_type, race, party, candidate, votes in rows:
        if not candidate or normalized_name(candidate) in {"overvotes", "undervotes", "over votes", "under votes"}:
            continue
        if not isinstance(votes, (int, float)):
            continue
        statewide = race in STATE_OFFICES or re.fullmatch(r"State (?:Senator|Representative) District \d+(?: Seat [AB])?", race or "")
        key = race if statewide else f"{county}|{race}"
        grouped[key][(candidate, party)] += int(votes)
    histories = {}
    for key, values in grouped.items():
        candidates = sorted(({"name": n, "party": p, "votes": v} for (n, p), v in values.items()),
                            key=lambda c: -c["votes"])
        total = sum(c["votes"] for c in candidates)
        margin = (candidates[0]["votes"] - candidates[1]["votes"]) / total * 100 if total and len(candidates) > 1 else None
        histories[key] = {"year": year, "sourceUrl": HISTORY_URL.format(year=year), "candidates": candidates,
                          "totalVotes": total, "marginPoints": margin}
    return histories


def prepare_history():
    from openpyxl import load_workbook
    histories = {}
    for year in (2022, 2024):
        path = DATA / "raw" / f"{year}-results.xlsx"
        if not path.exists():
            continue
        workbook = load_workbook(path, read_only=True, data_only=True)
        rows = workbook.active.iter_rows(min_row=2, values_only=True)
        histories.update(aggregate_history(rows, year))
        workbook.close()
    write_json(DATA / "history.json", histories)
    return histories


def candidates_for(item):
    return [{"id": option["id"], "name": option["name"], "party": option.get("politicalParty"),
             "votes": int(option.get("voteCount") or 0), "finance": None} for option in item.get("ballotOptions", [])]


def normalized_race(item, category, history, finance, counties, local_id=False):
    match = re.fullmatch(r"(sen|rep)(\d+)([ab])?", item["id"])
    district = int(match[2]) if match else None
    chamber = ("senate" if match[1] == "sen" else f"house-{match[3]}") if match else None
    candidates = candidates_for(item)
    total = sum(c["votes"] for c in candidates)
    name = item["name"]
    race_id = "ada:" + item["id"] if local_id else item["id"]
    county_results = []
    for county in counties:
        part = next((x for x in county.get("ballotItems", []) if x["id"] == item["id"]), None)
        if not part or (local_id and county["name"] != "Ada County"):
            continue
        cs = candidates_for(part)
        county_results.append({"county": county["name"], "votes": sum(c["votes"] for c in cs),
                               "candidates": cs, "precinctsReporting": part.get("precinctsReporting"),
                               "precinctsParticipating": part.get("precinctsParticipating")})
    reporting = item.get("precinctsReporting")
    participating = item.get("precinctsParticipating")
    if reporting is None and county_results and all(x["precinctsReporting"] is not None for x in county_results):
        reporting = sum(x["precinctsReporting"] for x in county_results)
    if participating is None and county_results and all(x["precinctsParticipating"] is not None for x in county_results):
        participating = sum(x["precinctsParticipating"] for x in county_results)
    is_measure = item.get("contestType") != "Candidate"
    historical = None if is_measure else history.get(f"Ada County|{name}" if category == "ada" else name)
    jurisdiction = f"Legislative District {district}" if district else ("Idaho statewide" if category == "statewide" else "Ada County")
    if "Highway District" in name:
        jurisdiction = "Ada County • elected countywide in 2026"
        historical = None  # The electing geography changed; do not imply comparable swing.
    elif category == "ada" and item.get("type") == "State":
        jurisdiction = "Multicounty district • includes Ada County"
    short = f"District {district} · " + ("Senate" if chamber == "senate" else "House " + chamber[-1].upper()) if match else name
    race = {"id": race_id, "name": name, "shortName": short, "category": category, "district": district,
            "chamber": chamber, "kind": "measure" if is_measure else "candidate", "jurisdiction": jurisdiction,
            "status": "reporting" if total > 0 or (reporting or 0) > 0 else "awaiting", "votes": total,
            "precinctsReporting": reporting, "precinctsParticipating": participating,
            "candidates": candidates, "history": historical, "countyResults": county_results}
    if not is_measure:
        for candidate in candidates:
            candidate["finance"] = match_finance(race, candidate, finance)
    return race


def normalize(raw, history=None, finance=None):
    if raw.get("electionDate") != "2026-11-03":
        raise ValueError("The source is not the November 3, 2026 election.")
    history, finance = history or {}, finance or []
    counties = raw.get("localResults", [])
    aggregate = raw["results"]["ballotItems"]
    selected = []
    for item in aggregate:
        if re.fullmatch(r"(?:sen\d+|rep\d+[ab])", item["id"]):
            selected.append(normalized_race(item, "legislature", history, finance, counties))
        elif item["id"] in STATE_IDS:
            selected.append(normalized_race(item, "statewide", history, finance, counties))
    ada = next((x for x in counties if x["name"] == "Ada County"), None)
    aggregate_lookup = {item["id"]: item for item in aggregate}
    if ada:
        for item in ada.get("ballotItems", []):
            if re.search(r"\b(?:Judge|Magistrate|Justice)\b", item["name"], re.IGNORECASE):
                continue
            if item.get("type") == "Local":
                selected.append(normalized_race(item, "ada", history, finance, [ada], local_id=True))
            elif item["id"] not in STATE_IDS and not re.fullmatch(r"(?:sen\d+|rep\d+[ab]|usrep\d+)", item["id"]):
                selected.append(normalized_race(aggregate_lookup.get(item["id"], item), "ada", history, finance, counties))
    order = {"legislature": 0, "statewide": 1, "ada": 2}
    seats = {"senate": 0, "house-a": 1, "house-b": 2, None: 0}
    selected.sort(key=lambda r: (order[r["category"]], r["district"] or 0, seats[r["chamber"]]))
    return {"meta": {"electionDate": raw["electionDate"], "electionName": raw.get("electionName"),
                     "sourceUpdatedAt": raw.get("createdAt"), "fetchedAt": None, "fetchError": None,
                     "sourceUrl": RESULTS_PAGE, "historySourceUrl": HISTORY_URL.format(year=2024),
                     "financeSourceUrl": FINANCE_PAGE, "financeUpdatedAt": None}, "races": selected}


class ElectionStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.refresh_lock = threading.Lock()
        self.history = read_json(DATA / "history.json", {})
        self.finance = read_json(DATA / "finance.json", {"records": [], "fetchedAt": None})
        self.current = read_json(DATA / "current.json")
        raw = read_json(DATA / "raw" / "2026-results.json")
        if self.current is None and raw:
            self.current = self.build(raw)

    def build(self, raw):
        data = normalize(raw, self.history, self.finance.get("records", []))
        data["meta"]["financeUpdatedAt"] = self.finance.get("fetchedAt")
        return data

    def get(self):
        with self.lock:
            return self.current

    def refresh_finance(self):
        rows = []
        page = 1
        while True:
            response = json.loads(download(FINANCE_URL, {"pageNumber": page, "pageSize": 1000,
                                                        "filerTypeCode": "CAN", "election": "2026"}))
            block = response["data"]
            batch = block["items"]
            rows.extend({key: item.get(key) for key in FINANCE_FIELDS} for item in batch)
            if len(rows) >= int(block["totalItems"]):
                break
            if not batch:
                raise ValueError("Sunshine returned an incomplete candidate list.")
            page += 1
        finance = {"records": rows, "fetchedAt": utc_now(), "source": FINANCE_URL}
        write_json(DATA / "finance.json", finance)
        self.finance = finance

    def refresh(self):
        if not self.refresh_lock.acquire(blocking=False):
            return self.get()
        try:
            raw_bytes = download(RESULTS_URL)
            raw = json.loads(raw_bytes)
            data = self.build(raw)
            previous = self.get()
            old_time = (previous or {}).get("meta", {}).get("sourceUpdatedAt")
            new_time = data["meta"].get("sourceUpdatedAt")
            if not new_time or (old_time and datetime.fromisoformat(new_time.replace("Z", "+00:00")) < datetime.fromisoformat(old_time.replace("Z", "+00:00"))):
                raise ValueError("The results source returned an older or undated snapshot; keeping the last valid results.")
            if len([r for r in data["races"] if r["category"] == "legislature"]) != 105:
                raise ValueError("The results source did not contain all 105 legislative contests; keeping the last valid results.")
            data["meta"]["fetchedAt"] = utc_now()
            if new_time != old_time:
                snapshots = DATA / "snapshots"
                snapshots.mkdir(parents=True, exist_ok=True)
                filename = re.sub(r"[^0-9A-Za-z]", "-", new_time) + ".json.gz"
                (snapshots / filename).write_bytes(gzip.compress(raw_bytes))
            write_json(DATA / "raw" / "2026-results.json", raw)
            write_json(DATA / "current.json", data)
            with self.lock:
                self.current = data
        except (ValueError, KeyError, TypeError, OSError, RuntimeError, subprocess.SubprocessError) as error:
            with self.lock:
                if self.current:
                    self.current = {**self.current, "meta": {**self.current["meta"], "fetchError": str(error)}}
            if self.current is None:
                raise
        finally:
            self.refresh_lock.release()
        return self.get()
