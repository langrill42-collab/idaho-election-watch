import copy
import unittest

from projections import attach_projections, bucket_for_upset


def race(race_id="sen15", district=15, margin=4, changed=False):
    history = {"year": 2024, "sourceUrl": "https://example.org/2024", "candidates": [
        {"name": "Pat Red", "party": "Republican", "votes": 500 + margin * 5},
        {"name": "Lee Blue", "party": "Democratic", "votes": 500 - margin * 5}]}
    return {"id": race_id, "category": "legislature", "district": district,
            "kind": "candidate", "history": history, "votes": 0, "status": "awaiting",
            "candidates": [{"id": "r", "name": "New Red" if changed else "Pat Red", "party": "Republican", "votes": 0},
                           {"id": "d", "name": "Lee Blue", "party": "Democratic", "votes": 0}]}


def ratings(*races):
    return attach_projections({"meta": {}, "races": list(races)})["races"]


class ProjectionTests(unittest.TestCase):
    def test_bands_have_no_gaps_or_overlaps(self):
        cases = [(0.5, "toss-up"), (0.4, "toss-up"), (0.399, "likely"),
                 (0.25, "likely"), (0.249, "very-likely"), (0.05, "very-likely"),
                 (0.049, "longshot"), (0.01, "longshot"), (0.009, "no-contest")]
        for chance, expected in cases:
            with self.subTest(chance=chance):
                self.assertEqual(bucket_for_upset(chance), expected)

    def test_returns_and_fundraising_do_not_change_pre_election_rating(self):
        before = race(margin=20)
        after = copy.deepcopy(before)
        after.update(votes=100000, status="reporting")
        after["candidates"][1].update(votes=100000, finance={"raised": 10000000})
        self.assertEqual(ratings(before)[0]["projection"], ratings(after)[0]["projection"])

    def test_prior_unopposed_result_cannot_create_a_landslide_prediction(self):
        r = race()
        r["history"]["candidates"] = r["history"]["candidates"][:1]
        self.assertEqual(ratings(copy.deepcopy(r))[0]["projection"]["bucket"], "unrated")
        p = ratings(r, race("rep15a", margin=0))[0]["projection"]
        self.assertEqual(p["bucket"], "toss-up")
        self.assertEqual(p["basis"], "district")

    def test_candidate_change_reduces_reliance_on_old_candidate_result(self):
        old = ratings(race(margin=20), race("rep15a", margin=0))[0]["projection"]
        new = ratings(race(margin=20, changed=True), race("rep15a", margin=0))[0]["projection"]
        self.assertLess(abs(new["marginPoints"]), abs(old["marginPoints"]))
        self.assertGreater(new["uncertaintyPoints"], old["uncertaintyPoints"])

    def test_same_candidates_receive_no_extra_incumbency_bonus(self):
        p = ratings(race(margin=20))[0]["projection"]
        self.assertEqual(p["marginPoints"], 20)
        self.assertEqual(p["favoredCandidateId"], "r")
        self.assertTrue(p["preliminary"])

    def test_unopposed_is_a_roster_status_and_multiway_is_unrated(self):
        single = race()
        single["candidates"] = single["candidates"][:1]
        self.assertEqual(ratings(single)[0]["projection"]["bucket"], "unopposed")
        multi = race()
        multi["candidates"].append({"id": "i", "name": "Other", "party": "Independent"})
        self.assertEqual(ratings(multi)[0]["projection"]["bucket"], "unrated")

    def test_independent_identity_and_district_boundaries_are_not_transferable(self):
        independent = race()
        independent["candidates"][0]["party"] = "Constitution"
        independent["history"]["candidates"][0]["party"] = "Constitution"
        independent["candidates"][1].update(name="New Independent", party="Independent")
        independent["history"]["candidates"][1]["party"] = "Independent"
        self.assertEqual(ratings(independent)[0]["projection"]["bucket"], "unrated")
        missing = race()
        missing["history"] = None
        self.assertEqual(ratings(missing, race("sen14", district=14, margin=60))[0]["projection"]["bucket"], "unrated")

    def test_single_major_party_candidate_is_no_contest_against_minor_opposition(self):
        for party, opponents in (("Republican", ["Independent"]),
                                 ("Democratic", ["Libertarian"]),
                                 ("Republican", ["Independent", "Constitution"])):
            with self.subTest(party=party, opponents=opponents):
                r = race(margin=-60)
                r["candidates"] = [{"id": "major", "name": "Major Candidate", "party": party}] + [
                    {"id": str(i), "name": f"Opponent {i}", "party": opponent}
                    for i, opponent in enumerate(opponents)]
                p = ratings(r)[0]["projection"]
                self.assertEqual(p["bucket"], "no-contest")
                self.assertEqual(p["favoredCandidateId"], "major")
                self.assertEqual(p["basis"], "single-major-party")
                self.assertIsNone(p["marginPoints"])

    def test_single_major_party_rule_does_not_pick_between_two_major_candidates(self):
        r = race()
        r["candidates"][1]["party"] = "Republican"
        self.assertEqual(ratings(r)[0]["projection"]["bucket"], "unrated")

    def test_non_legislative_races_are_not_given_partisan_predictions(self):
        r = race()
        r["category"] = "ada"
        self.assertEqual(ratings(r)[0]["projection"]["bucket"], "unrated")

    def test_2022_contributes_one_third_and_widens_uncertainty_when_years_disagree(self):
        r = race(margin=12)
        r["history2022"] = race(margin=-12)["history"]
        r["history2022"]["year"] = 2022
        p = ratings(r)[0]["projection"]
        self.assertAlmostEqual(p["marginPoints"], 4)
        self.assertGreater(p["uncertaintyPoints"], 12)
        self.assertEqual(p["years"], [2024, 2022])

    def test_contested_2022_is_used_when_2024_was_unopposed(self):
        r = race()
        r["history"]["candidates"] = r["history"]["candidates"][:1]
        r["history2022"] = race(margin=6)["history"]
        r["history2022"]["year"] = 2022
        p = ratings(r)[0]["projection"]
        self.assertEqual(p["years"], [2022])
        self.assertEqual(p["marginPoints"], 6)
        self.assertGreaterEqual(p["uncertaintyPoints"], 20)


if __name__ == "__main__":
    unittest.main()
