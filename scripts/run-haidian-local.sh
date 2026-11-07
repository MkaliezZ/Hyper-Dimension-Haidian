#!/bin/bash
# Foreground, task-specific local preview. No hidden keeper and no UW volume access.
set -euo pipefail
cd "$(dirname "$0")/.."
config=/var/tmp/hyper-haidian-20261103
new_config=0
sudo -n service docker start
if [[ ! -f "$config/compose.env" ]]; then
  python3 base/deploy/configure.py --out "$config" --project hyper-haidian-20261103 --namespace haidian20261103 --fixtures --base-port 6290 --idp-port 9280 --forum-port 5667 --nakama-port 9450 --pg-port 55549
  new_config=1
fi
python3 - "$config/deployment.json" <<'PY'
import sys,json
c=json.load(open(sys.argv[1]))
if c['project']!='hyper-haidian-20261103' or c['namespace']!='haidian20261103' or not c.get('fixtureOnly'):
    raise SystemExit('Existing foreign configuration preserved; choose a separate instance.')
PY
export HD_STACK_IMAGE=${HD_STACK_IMAGE:-hyper-campus:uw-a2a-workbench-v0113-final}
if ! docker image inspect "$HD_STACK_IMAGE" >/dev/null 2>&1; then
  printf '%s\n' 'The verified dependency image is missing. Follow docs/DEPLOY-HAIDIAN.md and explicitly set HD_STACK_IMAGE to a compatible image.'
  exit 1
fi
compose=(docker compose --env-file "$config/compose.env" -f deploy/compose.yaml -f deploy/compose.source.yaml)
hermes_mode="$(python3 - "$config/compose.env" <<'PY'
import json,pathlib,sys
values={}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if '=' not in line or line.lstrip().startswith('#'): continue
    name,value=line.split('=',1)
    try: value=json.loads(value)
    except json.JSONDecodeError: value=value.strip().strip('"').strip("'")
    values[name]=value
enabled=str(values.get('HD_HAIDIAN_HERMES_ENABLED','0'))=='1'
if enabled:
    secret=values.get('HD_RECEPTION_MODEL_KEY_FILE')
    if not secret or not pathlib.Path(secret).is_file():
        raise SystemExit('Haidian Hermes is enabled but its dedicated private model-key file is missing.')
print('enabled' if enabled else 'disabled')
PY
)"
if [[ "$hermes_mode" == enabled ]]; then
  compose+=(-f deploy/compose.hermes.yaml)
fi
"${compose[@]}" up -d --no-build --wait
if [[ "$new_config" == 1 ]]; then
  "${compose[@]}" run --rm --no-deps -e HD_M1_TEST_FIXTURE=1 utility seed-uw-fixtures
  "${compose[@]}" exec -T -e HD_M1_TEST_FIXTURE=1 base node /uw/scripts/seed-haidian-public-info.mjs
fi
printf '%s\n' '海淀校园已就绪：http://127.0.0.1:6290/  Ctrl+C 停止本实例，数据保留。'
trap '"${compose[@]}" stop; exit 0' INT TERM
"${compose[@]}" logs --follow --tail 8 base &
wait $!
