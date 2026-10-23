import unittest

import numpy as np

from server.isolation_forest import analyze


class IsolationForestTests(unittest.TestCase):
    def test_isolated_point_ranks_highest_and_is_deterministic(self):
        points = np.random.RandomState(8).normal(0, 0.1, (30, 3)).tolist() + [[20, 30, -40]]
        payload = {"points": points, "config": {"trees": 50}}
        result = analyze(payload)
        self.assertTrue(result["results"][-1]["isAnomaly"])
        self.assertEqual(max(row["score"] for row in result["results"]), result["results"][-1]["score"])
        self.assertEqual(result["results"], analyze(payload)["results"])

    def test_first_tree_trace_partitions_sample(self):
        points = np.random.RandomState(12).normal(size=(80, 3)).tolist()
        result = analyze({"points": points, "config": {"trees": 50, "sampleSize": 64}})
        trace = result["treeTrace"]
        self.assertEqual(len(trace["sampleIndices"]), 64)
        self.assertEqual(set(trace["steps"][0]["indices"]), set(trace["sampleIndices"]))
        for step in trace["steps"]:
            left = set(step["leftIndices"])
            right = set(step["rightIndices"])
            self.assertFalse(left & right)
            self.assertEqual(left | right, set(step["indices"]))
            self.assertTrue(all(result["results"][i]["normalizedVector"][step["dimension"]] <= step["cut"] for i in left))
            self.assertTrue(all(result["results"][i]["normalizedVector"][step["dimension"]] > step["cut"] for i in right))
        self.assertTrue(all(row["isAnomaly"] == (row["score"] > 0) for row in result["results"]))

    def test_identical_rows_and_invalid_config(self):
        result = analyze({"points": [[1, 1]] * 7, "config": {"trees": 50}})
        self.assertEqual(result["summary"]["anomalies"], 0)
        self.assertEqual(result["treeTrace"]["steps"], [])
        for config in ({"trees": 2}, {"sampleSize": 5}, {"contamination": 0}, {"contamination": 0.6}, {"contamination": float("nan")}):
            with self.assertRaises(ValueError):
                analyze({"points": [[1], [2], [3]], "config": config})


if __name__ == "__main__":
    unittest.main()
