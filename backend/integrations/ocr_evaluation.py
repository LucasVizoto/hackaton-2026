"""Private, paired OCR evaluation. Offline reports never require API credentials."""
import hashlib
import json
import statistics
from pathlib import Path


def load_manifest(path):
    path = Path(path).resolve()
    documents = json.loads(path.read_text(encoding="utf-8"))["documents"]
    ids = set()
    for doc in documents:
        if not isinstance(doc["id"], str) or not doc["id"] or doc["id"] in ids:
            raise ValueError("Manifest IDs must be unique, non-empty strings.")
        ids.add(doc["id"])
        for field in ("number", "access_key"):
            value = doc[field]
            if value is not None and (not isinstance(value, str) or not value.isascii() or not value.isdigit()):
                raise ValueError("Labels must be digit strings or null.")
        if doc["status"] not in {"suggested", "unreadable", "ambiguous"}:
            raise ValueError("Invalid expected status.")
        doc["path"] = (path.parent / doc["file"]).resolve()
        doc["sha256"] = hashlib.sha256(doc["path"].read_bytes()).hexdigest()
    if not documents:
        raise ValueError("The labeled manifest is empty.")
    return documents


def paired_metrics(documents, results):
    rows = results["documents"]
    indexed = {row["id"]: row for row in rows}
    if len(indexed) != len(rows) or set(indexed) != {doc["id"] for doc in documents}:
        raise ValueError("Results must cover every manifest ID exactly once.")
    counts = {"number_exact": 0, "access_key_exact": 0, "wrong_suggestions": 0,
              "no_reading": 0, "provider_failures": 0, "ambiguous_correct": 0}
    durations, tokens = [], 0
    for doc in documents:
        row = indexed[doc["id"]]
        if row["sha256"] != doc["sha256"]:
            raise ValueError("Document hashes differ; a paired comparison is impossible.")
        for field, counter in (("number", "number_exact"), ("access_key", "access_key_exact")):
            # Exact identifiers on documents whose ground truth contains that field.
            if doc[field] is not None and row.get(field) == doc[field]:
                counts[counter] += 1
        if any(row.get(field) is not None and row.get(field) != doc[field] for field in ("number", "access_key")):
            counts["wrong_suggestions"] += 1
        if not row.get("number") and not row.get("access_key"):
            counts["no_reading"] += 1
        if row.get("status") == "failed":
            counts["provider_failures"] += 1
        if doc["status"] == "ambiguous" and row.get("status") == "ambiguous" and not row.get("number") and not row.get("access_key"):
            counts["ambiguous_correct"] += 1
        durations.append(row.get("duration_ms", 0))
        tokens += row.get("total_tokens", 0)
    number_total = sum(doc["number"] is not None for doc in documents)
    key_total = sum(doc["access_key"] is not None for doc in documents)
    return {**counts, "documents": len(documents), "number_labeled": number_total, "access_key_labeled": key_total,
            "number_accuracy": counts["number_exact"] / number_total if number_total else None,
            "access_key_accuracy": counts["access_key_exact"] / key_total if key_total else None,
            "median_duration_ms": statistics.median(durations), "total_tokens": tokens}


def compare(documents, baseline, candidate):
    before, after = paired_metrics(documents, baseline), paired_metrics(documents, candidate)
    ambiguous_total = sum(doc["status"] == "ambiguous" for doc in documents)
    accepted = (len(documents) >= 100 and before["number_labeled"] > 0
                and after["number_exact"] > before["number_exact"]
                and after["access_key_exact"] >= before["access_key_exact"]
                and after["wrong_suggestions"] < before["wrong_suggestions"]
                and after["ambiguous_correct"] == ambiguous_total and not after["provider_failures"])
    return {"baseline_revision": baseline.get("source_revision"), "baseline": before, "candidate": after,
            "acceptance_passed": accepted, "required_real_documents": 100,
            "note": "Accuracy is proven only for this labeled set; real documents and representative coverage are required."}
