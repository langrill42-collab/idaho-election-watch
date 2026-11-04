from math import erfc, sqrt
from statistics import median
import re
import unicodedata

MODEL_VERSION = "legislative-two-cycle-v4"
MAJOR_PARTIES = {"Republican", "Democratic"}
DEMOCRATIC_SHIFT_POINTS = 5


def bucket_for_upset(chance):
    for threshold, bucket in ((.4, "toss-up"), (.25, "likely"), (.05, "very-likely"),
                              (.01, "longshot")):
        if chance >= threshold:
            return bucket
    return "no-contest"


def identity(candidate):
    name = unicodedata.normalize("NFKD", candidate["name"]).encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", name)), candidate.get("party")


def major_margin(history):
    """Return an R-minus-D margin only for a comparable contested baseline."""
    people = (history or {}).get("candidates", [])
    pairs = {party: [c for c in people if c.get("party") == party] for party in MAJOR_PARTIES}
    if any(len(candidates) != 1 or candidates[0]["votes"] <= 0 for candidates in pairs.values()):
        return None
    red, blue = pairs["Republican"][0]["votes"], pairs["Democratic"][0]["votes"]
    total = sum(c["votes"] for c in people)
    if (red + blue) / total < .95:
        return None
    return 100 * (red - blue) / (red + blue)


def historical(race, year):
    history = race.get("history" if year == 2024 else "history2022")
    return history if history and history.get("year") == year else None


def cycle_baseline(race, races, year):
    candidates = race["candidates"]
    history = historical(race, year)
    previous = (history or {}).get("candidates", [])
    same = {identity(c) for c in candidates} == {identity(c) for c in previous}
    sources = []
    if {c.get("party") for c in candidates} == MAJOR_PARTIES:
        own = major_margin(history)
        peers = []
        for other in races:
            if (other["category"] != "legislature" or other["district"] != race["district"]
                    or other["id"] == race["id"]):
                continue
            peer_history = historical(other, year)
            peer_margin = major_margin(peer_history)
            if peer_margin is not None:
                peers.append((peer_history, peer_margin))
        district = median(margin for _, margin in peers) if peers else None
        if own is None and district is None:
            return None
        if own is None:
            margin, uncertainty, basis = district, 20, "district"
            reason = "No comparable contested seat result; using other contested seats in this district."
        else:
            weight = .75 if same else .5
            margin = own if district is None else weight * own + (1 - weight) * district
            uncertainty = 12 if same else 16
            basis = "seat-and-district" if district is not None else "seat"
            reason = "Contested seat result" + (" cross-checked against other seats in this district." if district is not None else ".")
            sources.append(history)
            if district is not None:
                uncertainty = sqrt(uncertainty ** 2 + ((own - district) / 2) ** 2)
        sources.extend(history for history, _ in peers)
    elif same and len(previous) == 2 and all(c["votes"] > 0 for c in previous):
        first_votes = next(c["votes"] for c in previous if identity(c) == identity(candidates[0]))
        total = sum(c["votes"] for c in previous)
        margin, uncertainty, basis = 100 * (2 * first_votes - total) / total, 16, "same-candidates"
        reason = "Using the previous margin for this same two-candidate matchup."
        sources.append(history)
    else:
        return None
    if basis != "district":
        reason += " Same candidates; no additional incumbency bonus." if same else " Changed candidate field; wider uncertainty."
    return {"year": year, "margin": margin, "uncertainty": uncertainty, "basis": basis,
            "reason": f"{year}: {reason}", "sources": sources}


def project_race(race, races):
    result = {"version": MODEL_VERSION, "bucket": "unrated", "favoredCandidateId": None,
              "underdogCandidateId": None, "preliminary": True, "basis": None, "years": [],
              "marginPoints": None, "uncertaintyPoints": None, "reasons": [], "sources": []}
    candidates = race["candidates"]
    if race["category"] != "legislature":
        result["reasons"] = ["Automatic ratings currently cover legislative races only."]
        return result
    if len(candidates) == 1:
        result.update(bucket="unopposed", favoredCandidateId=candidates[0]["id"], preliminary=False,
                      reasons=["One candidate is listed in the official roster. This is a roster status, not a winner call."])
        return result
    major_candidates = [c for c in candidates if c.get("party") in MAJOR_PARTIES]
    if len(major_candidates) == 1:
        favored = major_candidates[0]
        opponents = [c for c in candidates if c["id"] != favored["id"]]
        result.update(bucket="no-contest", favoredCandidateId=favored["id"],
                      underdogCandidateId=opponents[0]["id"] if len(opponents) == 1 else None,
                      basis="single-major-party",
                      reasons=[f"Working assumption: {favored['name']} is the only Republican or Democratic candidate. Independent and minor-party opposition is treated as no real contest."])
        return result
    if len(candidates) != 2:
        result["reasons"] = ["This multi-candidate field needs a separate assessment. You can set your own rating."]
        return result
    cycles = [value for year in (2024, 2022) if (value := cycle_baseline(race, races, year))]
    if not cycles:
        result["reasons"] = ["No comparable contested baseline in 2024 or 2022. Independent and minor-party support is not transferred to a different candidate."]
        return result
    weights = [2 if c["year"] == 2024 else 1 for c in cycles]
    margin = sum(c["margin"] * w for c, w in zip(cycles, weights)) / sum(weights)
    # Two cycles share electoral conditions; do not shrink uncertainty as if independent.
    uncertainty = sum(c["uncertainty"] * w for c, w in zip(cycles, weights)) / sum(weights)
    if len(cycles) == 2:
        uncertainty = sqrt(uncertainty ** 2 + ((cycles[0]["margin"] - cycles[1]["margin"]) / 2) ** 2)
        result["reasons"].append("Uses 2024 with two-thirds weight and 2022 with one-third. Disagreement between years widens uncertainty.")
    elif cycles[0]["year"] == 2022:
        uncertainty = max(20, uncertainty)
        result["reasons"].append("Only 2022 supplies a comparable baseline; uncertainty is wider for the older result.")
    else:
        result["reasons"].append("Only 2024 supplies a comparable baseline; 2022 has no usable contested comparison.")
    if {c.get("party") for c in candidates} == MAJOR_PARTIES:
        margin -= DEMOCRATIC_SHIFT_POINTS
        result["reasons"].insert(0, f"Working assumption: shift the final historical baseline a full {DEMOCRATIC_SHIFT_POINTS} margin points toward Democrats, after blending the available years.")
    result["reasons"].extend(c["reason"] for c in cycles)
    first = next((c for c in candidates if c.get("party") == "Republican"), candidates[0]) if {c.get("party") for c in candidates} == MAJOR_PARTIES else candidates[0]
    second = next(c for c in candidates if c["id"] != first["id"])
    favored, underdog = (first, second) if margin >= 0 else (second, first)
    upset = .5 * erfc(abs(margin) / (uncertainty * sqrt(2)))
    bucket = bucket_for_upset(upset)
    result.update(bucket=bucket, marginPoints=round(margin, 3), uncertaintyPoints=round(uncertainty, 3),
                  favoredCandidateId=favored["id"] if bucket != "toss-up" else None,
                  underdogCandidateId=underdog["id"] if bucket != "toss-up" else None,
                  years=[c["year"] for c in cycles], basis=cycles[0]["basis"] if len(cycles) == 1 else "two-cycles",
                  sources=list(dict.fromkeys(h["sourceUrl"] for c in cycles for h in c["sources"] if h.get("sourceUrl"))))
    return result


def attach_projections(data, history2022=None):
    for race in data["races"]:
        if history2022 is not None and race["category"] == "legislature":
            race["history2022"] = history2022.get(race["name"])
    for race in data["races"]:
        race["projection"] = project_race(race, data["races"])
    data["meta"]["projectionVersion"] = MODEL_VERSION
    return data
