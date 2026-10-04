"""Compare a private baseline to recorded responses, or explicitly call OpenAI."""
import argparse
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "backend"))

def main():
    from integrations.ocr_evaluation import compare, load_manifest

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--baseline", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--candidate", help="Recorded OpenAI results; makes no network requests.")
    group.add_argument("--run-openai", action="store_true", help="Explicitly send all manifest documents to the configured provider.")
    parser.add_argument("--output-dir", required=True, help="Private output directory; identifiers in candidate results are sensitive.")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    if output == root or root in output.parents and root / ".private" not in output.parents and output != root / ".private":
        raise ValueError("Keep evaluation output outside the repository or under .private/.")
    documents = load_manifest(args.manifest)
    baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    # Verify the paired baseline before spending tokens or sending any document.
    from integrations.ocr_evaluation import paired_metrics
    paired_metrics(documents, baseline)
    if args.run_openai:
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
        import django
        django.setup()
        from django.core.files.uploadedfile import SimpleUploadedFile
        from integrations.invoice_reading import extract_invoice
        from integrations.providers import ProviderUnavailable, require_configuration
        from rest_framework.exceptions import Throttled, ValidationError
        require_configuration("invoice_reading")
        candidate = {"documents": []}
        for index, doc in enumerate(documents, 1):
            metrics = {}
            try:
                result = extract_invoice(SimpleUploadedFile("nota", doc["path"].read_bytes()), telemetry=metrics)
            except (ProviderUnavailable, Throttled, ValidationError, OSError) as error:
                # Store sanitized exception class, never error bodies/credentials.
                result = {"number": None, "access_key": None, "status": "failed", "error_type": type(error).__name__}
            candidate["documents"].append({"id": doc["id"], "sha256": doc["sha256"], **result,
                                           **{key: value for key, value in metrics.items() if key != "status"}})
            print(f"Processed {index}/{len(documents)}", flush=True)
    else:
        candidate = json.loads(Path(args.candidate).read_text(encoding="utf-8"))
    report = compare(documents, baseline, candidate)
    output.mkdir(parents=True, exist_ok=True)
    (output / "candidate.json").write_text(json.dumps(candidate, indent=2), encoding="utf-8")
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
