import hashlib
import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from integrations.ocr_evaluation import compare, load_manifest, paired_metrics


class OCREvaluationTests(SimpleTestCase):
    def test_paired_metrics_include_errors_abstention_latency_and_tokens(self):
        documents = [{"id": "one", "sha256": "a", "number": "000123", "access_key": "44", "status": "suggested"},
                     {"id": "two", "sha256": "b", "number": None, "access_key": None, "status": "ambiguous"}]
        results = {"documents": [{"id": "one", "sha256": "a", "number": "000123", "access_key": "45", "duration_ms": 10, "total_tokens": 5},
                                  {"id": "two", "sha256": "b", "number": None, "access_key": None, "status": "ambiguous", "duration_ms": 30}]}
        metrics = paired_metrics(documents, results)
        self.assertEqual(metrics["number_accuracy"], 1)
        self.assertEqual(metrics["access_key_accuracy"], 0)
        self.assertEqual(metrics["wrong_suggestions"], 1)
        self.assertEqual(metrics["no_reading"], 1)
        self.assertEqual(metrics["ambiguous_correct"], 1)
        self.assertEqual(metrics["median_duration_ms"], 20)
        self.assertEqual(metrics["total_tokens"], 5)
        self.assertFalse(compare(documents, results, results)["acceptance_passed"])

    def test_different_files_incomplete_results_and_duplicate_ids_cannot_claim_gain(self):
        docs = [{"id": "a", "sha256": "actual", "number": "123", "access_key": None, "status": "suggested"}]
        for rows in ([], [{"id": "a", "sha256": "other"}], [{"id": "a", "sha256": "actual"}] * 2):
            with self.assertRaises(ValueError):
                paired_metrics(docs, {"documents": rows})

    def test_manifest_resolves_paths_and_hashes_and_rejects_lossy_numeric_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "note.png").write_bytes(b"private original")
            manifest = source / "manifest.json"
            doc = {"id": "a", "file": "note.png", "number": "000123", "access_key": None, "status": "suggested"}
            manifest.write_text(json.dumps({"documents": [doc]}))
            loaded = load_manifest(manifest)
            self.assertEqual(loaded[0]["sha256"], hashlib.sha256(b"private original").hexdigest())
            self.assertEqual(loaded[0]["number"], "000123")
            doc["number"] = 123
            manifest.write_text(json.dumps({"documents": [doc]}))
            with self.assertRaises(ValueError):
                load_manifest(manifest)

    def test_acceptance_requires_100_paired_documents_and_improved_precision(self):
        docs = [{"id": str(i), "sha256": str(i), "number": "123", "access_key": "44", "status": "suggested"} for i in range(100)]
        baseline = {"source_revision": "legacy", "documents": [{**doc, "number": "124"} for doc in docs]}
        candidate = {"documents": [dict(doc) for doc in docs]}
        self.assertTrue(compare(docs, baseline, candidate)["acceptance_passed"])
        candidate["documents"][0]["status"] = "failed"
        self.assertFalse(compare(docs, baseline, candidate)["acceptance_passed"])
