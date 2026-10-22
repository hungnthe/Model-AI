"""Read one JSON request from stdin and stream analysis events to stdout."""

import json
import sys
import time
import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="rrcf")

import numpy as np
import rrcf


def emit(event):
    print(json.dumps(event, ensure_ascii=True, allow_nan=False), flush=True)


def validate_request(payload):
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

    settings = payload.get("config", {})
    if not isinstance(settings, dict):
        raise ValueError("Config phai la JSON object.")
    trees = settings.get("trees", 32)
    sample_size = settings.get("sampleSize", 128)
    threshold = settings.get("threshold", 10)
    if type(trees) is not int or trees not in (16, 32, 64):
        raise ValueError("So cay phai la 16, 32 hoac 64.")
    if type(sample_size) is not int or sample_size not in (64, 128, 256):
        raise ValueError("Kich thuoc mau phai la 64, 128 hoac 256.")
    if type(threshold) not in (int, float) or not np.isfinite(threshold) or not 0 < threshold <= 10000:
        raise ValueError("Nguong phai lon hon 0 va khong qua 10000.")

    return matrix, trees, sample_size, threshold


def normalize(matrix):
    center = np.median(matrix, axis=0)
    scale = np.quantile(matrix, 0.75, axis=0) - np.quantile(matrix, 0.25, axis=0)
    scale = np.where(scale > 0, scale, 1.0)
    normalized = (matrix - center) / scale
    if not np.isfinite(normalized).all() or np.abs(normalized).max() > 1e100:
        raise ValueError("Du lieu vuot mien tinh toan sau chuan hoa.")
    return normalized, center, scale


def score_forest(points, trees, sample_size, notify):
    count = len(points)
    actual_sample = min(sample_size, count)
    scores = np.zeros(count, dtype=np.float64)
    random = np.random.RandomState(42)
    forest = []
    notify({"type": "progress", "stage": "forest", "completed": 0, "total": trees})
    for tree_number in range(trees):
        indices = random.choice(count, size=actual_sample, replace=False)
        tree = rrcf.RCTree(random_state=42 + tree_number)
        for index in indices:
            tree.insert_point(points[index], index=int(index))
        forest.append(tree)
        notify({"type": "progress", "stage": "forest", "completed": tree_number + 1, "total": trees})

    for tree_number, tree in enumerate(forest):
        for index, point in enumerate(points):
            temporary = index not in tree.leaves
            if temporary:
                tree.insert_point(point, index=index)
            scores[index] += tree.codisp(index)
            if temporary:
                tree.forget_point(index)
        notify({"type": "progress", "stage": "score", "completed": tree_number + 1, "total": trees})

    return scores / trees, actual_sample


def analyze(payload, notify=lambda event: None):
    started = time.perf_counter()
    matrix, trees, sample_size, threshold = validate_request(payload)
    normalized, center, scale = normalize(matrix)
    notify({"type": "progress", "stage": "normalize", "completed": 0, "total": trees})
    count = len(matrix)
    scores, actual_sample = score_forest(normalized, trees, sample_size, notify)
    flagged = scores >= threshold
    return {
        "summary": {
            "total": count, "anomalies": int(flagged.sum()),
            "normal": int((~flagged).sum()), "maxScore": float(scores.max()),
            "durationMs": round((time.perf_counter() - started) * 1000),
        },
        "configuration": {
            "algorithm": "Robust Random Cut Forest / mean CoDisp", "engine": "rrcf 0.4.4",
            "mode": "batch", "trees": trees, "sampleSize": actual_sample,
            "requestedSampleSize": sample_size, "seed": 42, "threshold": threshold,
            "thresholdRule": "score >= threshold; user-configured, not a probability",
        },
        "normalization": {
            "method": "(x - median) / IQR; zero IQR uses scale 1",
            "median": center.tolist(), "scale": scale.tolist(),
        },
        "results": [
            {"rowIndex": i, "vector": matrix[i].tolist(),
             "normalizedVector": normalized[i].tolist(),
             "score": float(score), "isAnomaly": bool(flagged[i])}
            for i, score in enumerate(scores)
        ],
    }


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("Request phai la JSON object.")
        emit({"type": "result", "data": analyze(request, emit)})
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError) as error:
        emit({"type": "error", "message": str(error)})
        sys.exit(1)
