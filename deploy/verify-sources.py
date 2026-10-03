import hashlib
import json
from pathlib import Path

shared = Path('/srv/cocapec/shared')
root = shared / 'sources'
manifest = json.loads((shared / 'sources-manifest.json').read_text(encoding='utf-8-sig'))
for entry in manifest:
    source = (root / entry['path']).resolve()
    if not source.is_relative_to(root.resolve()):
        raise SystemExit('Invalid source path.')
    if hashlib.file_digest(source.open('rb'), 'sha256').hexdigest() != entry['sha256']:
        raise SystemExit('Private package hash mismatch.')
actual_paths = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
if actual_paths != {entry['path'] for entry in manifest}:
    raise SystemExit('Private package contains missing or unexpected files.')
print(f'Private package verified: {len(manifest)} files; SHA-256 matches.')
