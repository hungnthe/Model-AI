import unittest

import numpy as np

from server.analyze import analyze


class AnalysisTests(unittest.TestCase):
    def test_isolated_point_scores_higher_and_repeats_deterministically(self):
        random = np.random.RandomState(8)
        points = random.normal(0, 0.1, (30, 3)).tolist() + [[20, 30, -40]]
        payload = {"points": points, "config": {"trees": 16}}
        result = analyze(payload)
        self.assertTrue(result["results"][-1]["isAnomaly"])
        self.assertGreater(result["results"][-1]["score"], 20)
        self.assertEqual(result["results"], analyze(payload)["results"])

    def test_identical_records_are_not_anomalies(self):
        result = analyze({"points": [[1, 1]] * 7, "config": {"trees": 16}})
        self.assertEqual(result["summary"]["anomalies"], 0)
        self.assertEqual(result["summary"]["maxScore"], 0)

    def test_small_magnitude_features_keep_their_variation(self):
        result = analyze({"points": [[1e-14], [2e-14], [3e-14], [80e-14]], "config": {"trees": 16}})
        self.assertGreater(result["summary"]["maxScore"], 0)
        self.assertEqual(len({row["normalizedVector"][0] for row in result["results"]}), 4)

    def test_all_rows_scored_when_file_is_larger_than_sample(self):
        points = np.random.RandomState(10).normal(size=(70, 2)).tolist()
        result = analyze({"points": points, "config": {"trees": 16, "sampleSize": 64}})
        self.assertEqual(len(result["results"]), 70)
        self.assertTrue(all(np.isfinite(row["score"]) for row in result["results"]))
        self.assertEqual(result["configuration"]["sampleSize"], 64)

    def test_invalid_values_and_configuration(self):
        for points in ([[1], [2]], [[1], [2, 3], [4]], [[1], [True], [2]], [[1], [None], [2]], [[1], [float('inf')], [2]]):
            with self.assertRaises(ValueError):
                analyze({"points": points})
        for config in ({"trees": 1}, {"sampleSize": 5}, {"threshold": 0}, {"threshold": float('nan')}, None):
            with self.assertRaises(ValueError):
                analyze({"points": [[1], [2], [3]], "config": config})


if __name__ == '__main__':
    unittest.main()
