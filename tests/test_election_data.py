import unittest

from election_data import aggregate_history, match_finance, normalize


def contest(votes=0, reporting=0):
    return {"id": "sen15", "name": "State Senator District 15", "contestType": "Candidate",
            "precinctsReporting": reporting, "precinctsParticipating": 12,
            "ballotOptions": [{"id": "jane", "name": "Jane Doe", "politicalParty": "Democratic", "voteCount": votes}]}


def payload(votes=0, reporting=0):
    return {"electionDate": "2026-11-03", "electionName": "General Election", "createdAt": "2026-11-04T00:00:00Z",
            "results": {"ballotItems": [contest(votes, reporting)]},
            "localResults": [{"name": "Ada County", "ballotItems": [contest(votes, reporting)]}]}


class ElectionDataTests(unittest.TestCase):
    def test_county_breakdowns_are_not_added_to_aggregate(self):
        races = normalize(payload(100, 2))["races"]
        self.assertEqual(len(races), 1)
        self.assertEqual(races[0]["votes"], 100)
        self.assertEqual(races[0]["countyResults"][0]["votes"], 100)

    def test_unreported_zero_is_not_reported_zero(self):
        self.assertEqual(normalize(payload())["races"][0]["status"], "awaiting")
        self.assertEqual(normalize(payload(0, 1))["races"][0]["status"], "reporting")

    def test_seat_identity_is_preserved(self):
        p = payload()
        p["results"]["ballotItems"][0].update(id="rep15b", name="State Representative District 15 Seat B")
        r = normalize(p)["races"][0]
        self.assertEqual((r["district"], r["chamber"]), (15, "house-b"))

    def test_local_contest_ids_cannot_collide_with_state_ids(self):
        p = payload()
        local = contest()
        local.update(id="15", name="Ada County Highway District Commissioner Zone 3", type="Local")
        local["ballotOptions"][0]["politicalParty"] = None
        p["localResults"][0]["ballotItems"].append(local)
        r = normalize(p)["races"][-1]
        self.assertEqual(r["id"], "ada:15")
        self.assertEqual(r["category"], "ada")
        self.assertIsNone(r["candidates"][0]["party"])
        self.assertIn("countywide", r["jurisdiction"].lower())

    def test_history_excludes_overvotes_and_undervotes(self):
        rows = [("Ada County", "1501", "Legislative", "State Senator District 15", "Democratic", "Jane Doe", 60),
                ("Ada County", "1502", "Legislative", "State Senator District 15", "Democratic", "Jane Doe", 40),
                ("Ada County", "1501", "Legislative", "State Senator District 15", "Republican", "Pat Roe", 50),
                ("Ada County", "1501", "Legislative", "State Senator District 15", None, "Undervotes", 200),
                ("Ada County", "1501", "Legislative", "State Senator District 15", None, "Overvotes", 10)]
        h = aggregate_history(rows, 2024)["State Senator District 15"]
        self.assertEqual(h["totalVotes"], 150)
        self.assertEqual(len(h["candidates"]), 2)
        self.assertAlmostEqual(h["marginPoints"], 100 / 3)

    def test_ada_judges_and_retentions_are_excluded(self):
        p = payload()
        retention = {**contest(), "id": "8", "name": "Retain Magistrate Fafa Alidjani", "type": "Local", "contestType": "BallotMeasure"}
        judge = {**contest(), "id": "distjudge-4-ada-a", "name": "4th Judicial District Judge - Seat Ada A", "type": "State"}
        treasurer = {**contest(), "id": "42", "name": "County Treasurer", "type": "Local"}
        p["localResults"][0]["ballotItems"].extend([retention, judge, treasurer])
        ids = [r["id"] for r in normalize(p)["races"]]
        self.assertNotIn("ada:8", ids)
        self.assertNotIn("distjudge-4-ada-a", ids)
        self.assertIn("ada:42", ids)

    def test_finance_requires_matching_office_and_district(self):
        race = normalize(payload())["races"][0]
        row = {"electionYear": "2026", "office": "State Senator", "cityDistrict": "Legislative District 14",
               "firstNameLastName": "Jane Doe", "firstName": "Jane", "lastName": "Doe", "guid": "test",
               "totalRaised": 100, "totalSpent": 0, "balanceOfFunds": 100}
        self.assertIsNone(match_finance(race, race["candidates"][0], [row]))
        row["cityDistrict"] = "Legislative District 15"
        f = match_finance(race, race["candidates"][0], [row])
        self.assertEqual(f["raised"], 100)
        self.assertEqual(f["spent"], 0)
        self.assertIsNone(f["reportEnd"])

    def test_ambiguous_finance_is_not_arbitrarily_assigned(self):
        race = normalize(payload())["races"][0]
        row = {"electionYear": "2026", "office": "State Senator", "cityDistrict": "Legislative District 15",
               "firstNameLastName": "Jane Doe", "firstName": "Jane", "lastName": "Doe", "guid": "a"}
        self.assertIsNone(match_finance(race, race["candidates"][0], [row, dict(row, guid="b")]))


if __name__ == "__main__":
    unittest.main()
