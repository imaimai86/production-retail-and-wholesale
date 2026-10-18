#!/usr/bin/env bash
# sdlc-fetch.sh <https-url>: one GET request, printed to stdout. Stage agents may run this script without a prompt; they may
# not run curl itself, because a curl rule cannot be limited to GET (-d, -X, -F and -T would send data, -o writes files).
# Hosts: SDLC_FETCH_HOSTS (space-separated), default the npm registry, unpkg, jsDelivr and GitHub.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: sdlc-fetch.sh <https-url>" >&2; exit 2; }
url="$1"
hosts="${SDLC_FETCH_HOSTS:-registry.npmjs.org unpkg.com cdn.jsdelivr.net raw.githubusercontent.com github.com api.github.com}"
[[ "$url" =~ ^https://([A-Za-z0-9.-]+)(/[^[:space:]]*)?$ ]] || { echo "sdlc-fetch: only https://<host>/<path> URLs" >&2; exit 2; }
host="${BASH_REMATCH[1]}"
case " $hosts " in *" $host "*) ;; *) echo "sdlc-fetch: host $host is not allowed (SDLC_FETCH_HOSTS)" >&2; exit 2;; esac
# -q first: ignore ~/.curlrc, so no config file can add a method, data or an output file.
exec curl -q -fsSL --proto '=https' --proto-redir '=https' --max-redirs 5 --max-time 30 --max-filesize 5000000 -- "$url"
