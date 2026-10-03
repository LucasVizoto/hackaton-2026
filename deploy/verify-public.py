"""Verify the deployed contract without printing credentials or private responses."""
import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='https://cocapec.lucasvizoto.com')
parser.add_argument('--env', type=Path, default=Path('/srv/cocapec/shared/.env'))
args = parser.parse_args()
load_dotenv(args.env)
password = os.environ['DEMO_PASSWORD']


def request(path, token='', data=None, extra=None):
    headers = {'Accept': 'application/json', **(extra or {})}
    if token:
        headers['Authorization'] = 'Token ' + token
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    try:
        response = urlopen(Request(args.url + path, data=body, headers=headers), timeout=30)
    except HTTPError as error:
        return error.code, {}, {key.lower(): value for key, value in error.headers.items()}
    with response:
        raw = response.read()
        value = json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else raw
        return response.status, value, {key.lower(): value for key, value in response.headers.items()}


assert request('/api/v1/health/')[1] == {'status': 'ok', 'database': 'postgresql'}
assert request('/api/v1/auth/login/', data={'username': 'gestao_demo', 'password': 'deliberately-invalid'})[0] == 401
tokens = {}
for username, role in [
    ('fornecedor_demo', 'supplier'), ('fornecedor_b_demo', 'supplier'),
    ('compras_demo', 'purchasing'), ('armazem_demo', 'warehouse'), ('gestao_demo', 'management'),
]:
    status, login, headers = request('/api/v1/auth/login/', data={'username': username, 'password': password})
    assert status == 200 and login['user']['role'] == role
    assert 'no-store' in headers.get('cache-control', '')
    tokens[username] = login['token']
    assert request('/api/v1/auth/me/', tokens[username])[1]['role'] == role
supplier_a, supplier_b = tokens['fornecedor_demo'], tokens['fornecedor_b_demo']
invoice = request('/api/v1/invoices/', supplier_a)[1]['results'][0]
assert request(f"/api/v1/invoices/{invoice['id']}/", supplier_b)[0] == 404
download = f"/api/v1/attachments/{invoice['attachment_id']}/download/"
assert request(download)[0] == 401
assert request(download, supplier_b)[0] in (403, 404)
status, contents, headers = request(download, supplier_a)
assert status == 200 and len(contents) > 0 and 'no-store' in headers.get('cache-control', '')
for path in ('/.env', '/.git/config', '/.private/media/x', '/media/x', '/sources/x'):
    assert request(path)[0] == 404
assert request('/agenda')[0] == 200
status, config, headers = request('/runtime-config.json')
assert status == 200 and config['nativeApiUrl'] == args.url + '/api/v1'
assert 'no-store' in headers.get('cache-control', '')
status, _, headers = request('/api/v1/health/', extra={'Origin': 'https://localhost'})
assert status == 200 and headers.get('access-control-allow-origin') == 'https://localhost'
assert 'access-control-allow-origin' not in request('/api/v1/health/', extra={'Origin': 'https://untrusted.invalid'})[2]
print('Public HTTPS acceptance PASS: five roles, isolation, private downloads, SPA, Android origin and cache headers.')
