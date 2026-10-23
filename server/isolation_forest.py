"""Analyze numeric JSON vectors with scikit-learn Isolation Forest."""

import json
import sys
import time

import numpy as np
from sklearn.ensemble import IsolationForest


def emit(event):
    print(json.dumps(event, ensure_ascii=True, allow_nan=False), flush=True)


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request phai la JSON object.")
    points = payload.get("points")
    if not isinstance(points, list) or not 3 <= len(points) <= 2000:
        raise ValueError("Can tu 3 den 2000 ban ghi de phan tich.")
    if not all(isinstance(row, list) and row for row in points):
        raise ValueError("Moi ban ghi phai la mot vector so khong rong.")
    dimensions = len(points[0])
    if dimensions > 20 or any(len(row) != dimensions for row in points):
        raise ValueError("Vector phai co cung so chieu, toi da 20 truong.")
    if any(type(value) not in (int, float) for row in points for value in row):
        raise ValueError("Vector chi duoc chua so, khong chap nhan null hay chuoi.")
    matrix = np.asarray(points, dtype=np.float64)
    if not np.isfinite(matrix).all() or np.abs(matrix).max() > 1e100:
        raise ValueError("Gia tri so phai huu han va co tri tuyet doi khong qua 1e100.")

    config = payload.get("config", {})
    if not isinstance(config, dict):
        raise ValueError("Config phai la JSON object.")
    trees = config.get("trees", 100)
    sample_size = config.get("sampleSize", 256)
    contamination = config.get("contamination", 0.1)
    if type(trees) is not int or trees not in (50, 100, 200):
        raise ValueError("So cay phai la 50, 100 hoac 200.")
    if type(sample_size) is not int or sample_size not in (64, 128, 256):
        raise ValueError("Kich thuoc mau phai la 64, 128 hoac 256.")
    if type(contamination) not in (int, float) or not np.isfinite(contamination) or not 0.01 <= contamination <= 0.5:
        raise ValueError("Ty le bat thuong phai nam trong khoang 0.01 den 0.5.")
    return matrix, trees, sample_size, float(contamination)


def trace_first_tree(model, normalized, limit=24):
    estimator = model.estimators_[0]
    tree = estimator.tree_
    features = model.estimators_features_[0]
    sample_indices = [int(index) for index in model.estimators_samples_[0]]
    steps = []
    queue = [(0, sample_indices, "Goc")]
    while queue and len(steps) < limit:
        node, indices, path = queue.pop(0)
        if tree.feature[node] < 0:
            continue
        dimension = int(features[tree.feature[node]])
        cut = float(tree.threshold[node])
        left = [index for index in indices if normalized[index, dimension] <= cut]
        right = [index for index in indices if normalized[index, dimension] > cut]
        steps.append({
            "path": path, "dimension": dimension, "cut": cut,
            "indices": indices, "leftIndices": left, "rightIndices": right,
        })
        queue.append((int(tree.children_left[node]), left, path + " / Trai"))
        queue.append((int(tree.children_right[node]), right, path + " / Phai"))

    depths = np.zeros(tree.node_count, dtype=np.int32)
    pending = [0]
    while pending:
        node = pending.pop()
        if tree.feature[node] >= 0:
            for child in (tree.children_left[node], tree.children_right[node]):
                depths[child] = depths[node] + 1
                pending.append(int(child))
    leaf_indices = estimator.apply(normalized[:, features])
    return {"sampleIndices": sample_indices, "steps": steps}, depths[leaf_indices]


def analyze(payload, notify=lambda event: None):
    started = time.perf_counter()
    matrix, trees, sample_size, contamination = validate(payload)
    center = np.median(matrix, axis=0)
    scale = np.quantile(matrix, 0.75, axis=0) - np.quantile(matrix, 0.25, axis=0)
    scale = np.where(scale > 0, scale, 1.0)
    normalized64 = (matrix - center) / scale
    if not np.isfinite(normalized64).all() or np.abs(normalized64).max() > 1e30:
        raise ValueError("Du lieu vuot mien tinh toan cua Isolation Forest sau chuan hoa.")
    normalized = normalized64.astype(np.float32)
    notify({"type": "progress", "stage": "normalize", "completed": 1, "total": 3})

    actual_sample = min(sample_size, len(matrix))
    model = IsolationForest(
        n_estimators=trees, max_samples=actual_sample,
        contamination=contamination, random_state=42, n_jobs=1,
    )
    model.fit(normalized)
    notify({"type": "progress", "stage": "forest", "completed": 2, "total": 3})
    decision = model.decision_function(normalized)
    scores = -decision
    flagged = decision < 0
    trace, first_tree_depths = trace_first_tree(model, normalized)
    notify({"type": "progress", "stage": "score", "completed": 3, "total": 3})

    return {
        "summary": {
            "total": len(matrix), "anomalies": int(flagged.sum()),
            "normal": int((~flagged).sum()), "maxScore": float(scores.max()),
            "durationMs": round((time.perf_counter() - started) * 1000),
        },
        "configuration": {
            "algorithm": "Isolation Forest", "engine": "scikit-learn",
            "mode": "batch", "trees": trees, "sampleSize": actual_sample,
            "requestedSampleSize": sample_size, "contamination": contamination,
            "seed": 42, "thresholdRule": "score > 0; score = -decision_function",
        },
        "normalization": {
            "method": "(x - median) / IQR; zero IQR uses scale 1; float32 for sklearn",
            "median": center.tolist(), "scale": scale.tolist(),
        },
        "treeTrace": trace,
        "results": [
            {"rowIndex": i, "vector": matrix[i].tolist(),
             "normalizedVector": normalized[i].astype(np.float64).tolist(),
             "score": float(scores[i]), "isAnomaly": bool(flagged[i]),
             "firstTreeDepth": int(first_tree_depths[i])}
            for i in range(len(matrix))
        ],
    }


if __name__ == "__main__":
    try:
        emit({"type": "result", "data": analyze(json.load(sys.stdin), emit)})
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError) as error:
        emit({"type": "error", "message": str(error)})
        sys.exit(1)
