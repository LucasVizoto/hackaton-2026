import json
import os
import runpy
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class PrivateInventoryTests(SimpleTestCase):
    def test_atomic_inventory_merge_keeps_password_and_custom_entries(self):
        update = runpy.run_path(str(settings.REPO_DIR / "deploy/update-credentials.py"))["update"]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "credentials.json"
            original = {"password": "synthetic-never-rotate", "usernames": ["custom-account", "portaria_demo"], "extra": {"preserve": True}}
            path.write_text(json.dumps(original))
            update(path)
            first = path.read_bytes()
            update(path)
            self.assertEqual(path.read_bytes(), first)
            result = json.loads(first)
            self.assertEqual(result["password"], original["password"])
            self.assertEqual(result["extra"], original["extra"])
            self.assertEqual(result["usernames"].count("portaria_demo"), 1)
            self.assertIn("custom-account", result["usernames"])
            self.assertEqual(list(Path(folder).iterdir()), [path])
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
