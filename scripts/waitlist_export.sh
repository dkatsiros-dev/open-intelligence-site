#!/usr/bin/env bash
# Print the waitlist (KV namespace OI_WAITLIST) as CSV on stdout: email,ts,note,ua,ip_hash,index_key
# Needs CF_API_TOKEN (Workers KV Storage:Read) and CF_ACCOUNT_ID in the environment, e.g.
#   set -a; . ~/.openclaw/credentials/cloudflare.env; set +a; scripts/waitlist_export.sh > waitlist.csv
# Delete an entry: remove "email:<address>" and its index_key, e.g.
#   npx wrangler kv key delete --namespace-id <id> "email:<address>" --remote
# Usage: scripts/waitlist_export.sh [namespace-id]   (default: the id in wrangler.toml)
set -euo pipefail
: "${CF_API_TOKEN:?set CF_API_TOKEN}" "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"
here=$(cd "$(dirname "$0")/.." && pwd)
ns=${1:-$(sed -n 's/^id *= *"\([0-9a-f]*\)".*/\1/p' "$here/wrangler.toml" | head -1)}
[ -n "$ns" ] || { echo "no namespace id" >&2; exit 1; }
NS="$ns" python3 - <<'PY'
import csv, hashlib, json, os, sys, urllib.parse, urllib.request
base = "https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s" % (os.environ["CF_ACCOUNT_ID"], os.environ["NS"])
auth = {"Authorization": "Bearer " + os.environ["CF_API_TOKEN"]}
def get(path):
    with urllib.request.urlopen(urllib.request.Request(base + path, headers=auth)) as r:
        return r.read()
keys, cursor = [], ""
while True:
    page = json.loads(get("/keys?limit=1000&prefix=email:" + ("&cursor=" + cursor if cursor else "")))
    keys += [k["name"] for k in page["result"]]
    cursor = (page.get("result_info") or {}).get("cursor") or ""
    if not cursor:
        break
rows = []
for k in keys:
    v = json.loads(get("/values/" + urllib.parse.quote(k, safe="")))
    idx = "by_ts:%s:%s" % (v.get("ts", ""), hashlib.sha256(v.get("email", "").encode()).hexdigest()[:12])
    rows.append([v.get("email", ""), v.get("ts", ""), v.get("note", ""), v.get("ua", ""), v.get("ip_hash", ""), idx])
rows.sort(key=lambda r: r[1])
w = csv.writer(sys.stdout)
w.writerow(["email", "ts", "note", "ua", "ip_hash", "index_key"])
w.writerows(rows)
PY
