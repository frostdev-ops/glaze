#!/bin/bash
# Refresh the generated resources used when opening safari/Glaze directly, or check every byte before a build.
# Release builds stage their own temporary project and keep their existing resource validation.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
resources="$root/safari/Glaze/Glaze Extension/Resources"
case "${1:-}" in
  --check) [ "$#" -le 2 ] || exit 2; resources="${2:-$resources}" ;;
  --refresh) [ "$#" -eq 1 ] || exit 2 ;;
  *) echo 'usage: bash scripts/sync-safari-resources.sh --refresh | --check [resources-folder]' >&2; exit 2 ;;
esac
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
DIST="$stage" bash "$root/package.sh" >/dev/null
version=$(cd "$root" && node -p 'require("./manifest.json").version')
expected="$stage/Resources"
unzip -q "$stage/glaze-v$version.zip" -d "$expected"
sh "$root/scripts/safari-manifest.sh" "$expected/manifest.json"
node "$root/scripts/safari-resources.js" "$expected"
if [ "$1" = --refresh ]; then
  mkdir -p "$resources"
  rsync -a --delete "$expected/" "$resources/"
  echo 'Refreshed direct Xcode resources from the current Safari package.'
else
  python3 - "$expected" "$resources" <<'PY'
import pathlib, sys
expected, actual = map(pathlib.Path, sys.argv[1:])
def files(root):
    return {p.relative_to(root).as_posix(): p for p in root.rglob('*') if p.is_file() and p.name != '.DS_Store'}
want, have = files(expected), files(actual)
gaps = sorted(set(want) ^ set(have) | {f for f in want.keys() & have.keys() if want[f].read_bytes() != have[f].read_bytes()})
if gaps:
    print('error: Direct Xcode resources are stale. Run bash scripts/sync-safari-resources.sh --refresh from the source checkout.', file=sys.stderr)
    print('\n'.join('  ' + f for f in gaps), file=sys.stderr)
    sys.exit(1)
print(f'Direct Xcode resources match all {len(want)} current Safari package files.')
PY
fi
