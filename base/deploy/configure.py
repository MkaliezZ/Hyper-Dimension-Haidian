"""Create a new private Compose configuration, never start services or replace files."""
import argparse
import json
import os
import pathlib
import secrets

p = argparse.ArgumentParser()
p.add_argument('--out', required=True, type=pathlib.Path)
p.add_argument('--project')
p.add_argument('--namespace')
p.add_argument('--fixtures', action='store_true')
p.add_argument('--smtp', type=pathlib.Path)
p.add_argument('--base-port', type=int, default=6180)
p.add_argument('--idp-port', type=int, default=9180)
p.add_argument('--forum-port', type=int, default=5567)
p.add_argument('--nakama-port', type=int, default=9350)
p.add_argument('--pg-port', type=int, default=55439)
p.add_argument('--public-origin')
p.add_argument('--idp-origin')
p.add_argument('--hermes', action='store_true')
keys = p.add_mutually_exclusive_group()
keys.add_argument('--model-key-file', type=pathlib.Path)
keys.add_argument('--model-key-stdin', action='store_true')
a = p.parse_args()
if os.name != 'posix':
    raise SystemExit('Generate this server configuration inside Ubuntu/Linux so secret paths match Docker host paths.')
model_key = None
if a.hermes:
    if os.geteuid() != 0:
        raise SystemExit('Use sudo/root for Hermes configuration so the new secret can be owned by container UID 10001; no files were created.')
    import sys
    if a.model_key_file:
        model_key = a.model_key_file.read_text(encoding='utf-8').strip()
    elif a.model_key_stdin:
        model_key = sys.stdin.read().strip()
    if not model_key or len(model_key) > 4096 or '\n' in model_key or '\r' in model_key:
        raise SystemExit('Hermes needs a single private model key via file or stdin; no files were created.')
elif a.model_key_file or a.model_key_stdin:
    raise SystemExit('Model key input requires --hermes; no files were created.')
import re
project = a.project or 'hd-campus-' + secrets.token_hex(4)
namespace = a.namespace or 'hd' + secrets.token_hex(6)
if not re.fullmatch(r'[a-z][a-z0-9-]{2,45}', project) or not re.fullmatch(r'[a-z][a-z0-9_]{2,30}', namespace):
    raise SystemExit('Use a new lowercase project and PostgreSQL namespace.')
ports = [a.base_port, a.idp_port, a.idp_port+1, a.forum_port, a.forum_port+1,
         a.nakama_port, a.nakama_port+1, a.nakama_port+100, a.nakama_port+101, a.pg_port]
if len(set(ports)) != len(ports) or any(x < 1024 or x > 65535 for x in ports):
    raise SystemExit('Service ports must be distinct and between 1024 and 65535.')
out = a.out.resolve()
if any(x in str(out) for x in '\r\n'):
    raise SystemExit('Invalid output path.')
smtp = a.smtp.resolve() if a.smtp else None
from urllib.parse import urlsplit
public_origin = a.public_origin or 'http://127.0.0.1:' + str(a.base_port)
idp_origin = a.idp_origin or 'http://127.0.0.1:' + str(a.idp_port)
for origin in (public_origin, idp_origin):
    url = urlsplit(origin)
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise SystemExit('Origins must be exact HTTP(S) origins without credentials, path, query or fragment.')
if smtp:
    data = json.loads(smtp.read_text(encoding='utf-8'))
    if not data.get('host') or not data.get('from'):
        raise SystemExit('SMTP needs a real host and sender; no secret values were printed.')
out.mkdir(mode=0o700)  # Existing directories are intentionally refused.
password = out / 'postgres-password'
with password.open('x', encoding='utf-8') as f:
    os.chmod(password, 0o600)
    f.write(secrets.token_urlsafe(32) + '\n')
env = {
    'HD_STACK_NAME': project, 'HD_NAMESPACE': namespace,
    'HD_M1_TEST_FIXTURE': '1' if a.fixtures else '0',
    'HD_POSTGRES_PASSWORD_FILE': str(password),
    'HD_BASE_PORT': str(a.base_port), 'HD_IDP_PORT': str(a.idp_port),
    'HD_FORUM_PORT': str(a.forum_port), 'HD_NAKAMA_PORT': str(a.nakama_port),
    'HD_PG_PORT': str(a.pg_port),
    'HD_PUBLIC_ORIGIN': public_origin,
    'HD_IDP_ORIGIN': idp_origin,
}
if smtp:
    env['HD_SMTP_FILE'] = str(smtp)
if model_key is not None:
    key_path = out / 'reception-model-key'
    with key_path.open('x', encoding='utf-8') as f:
        os.fchmod(f.fileno(), 0o400)
        os.fchown(f.fileno(), 10001, 10001)
        f.write(model_key + '\n')
    env['HD_RECEPTION_MODEL_KEY_FILE'] = str(key_path)
with (out / 'compose.env').open('x', encoding='utf-8') as f:
    os.chmod(out / 'compose.env', 0o600)
    f.write(''.join(key + '=' + json.dumps(value, ensure_ascii=False) + '\n' for key, value in env.items()))
with (out / 'deployment.json').open('x', encoding='utf-8') as f:
    os.chmod(out / 'deployment.json', 0o600)
    json.dump({'schema':'hyper-dimension.deployment/v1','project':project,'namespace':namespace,'fixtureOnly':a.fixtures,'ports':ports}, f, indent=2)
print(json.dumps({'configuration':str(out / 'compose.env'),'project':project,'fixtureOnly':a.fixtures,'secrets':'private files; not printed','servicesStarted':False}))
