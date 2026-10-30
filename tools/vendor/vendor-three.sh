#!/usr/bin/env bash
# Rebuild lib/three.js: only the parts of three.js that lib/scene.js imports, tree-shaken into one readable ES module
# (three's own names and layout; not minified, which the Chrome Web Store can take for obfuscation, 2026-10-26).
# The output is checked in, so the extension itself still has no build step.
# Like the other vendor scripts it trusts nothing it downloads: exact versions, install scripts off, every installed package
# checked against the SHA-512 integrity pinned below before esbuild runs, and the result against the SHA-256 of the
# checked-in file. To upgrade, pick the new versions, copy their integrity from `npm view <package>@<version> dist.integrity`
# (esbuild's binaries are its optional dependencies, one package per platform), run this once, and record the new file hash.
# Usage: scripts/vendor-three.sh
set -euo pipefail
cd "$(dirname "$0")/.."

three_version=0.186.1
esbuild_version=0.28.2
file_sha256=d5e1fc0c8bac29153f135da4e69a99497956c83958ad217f52cc7a288eedca13
integrity=$(cat <<'EOF'
three@0.186.1 sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==
esbuild@0.28.2 sha512-HKVLS8dvII+xoKW9kmqxbRKrnWEXfJJr/FZhhJmiqIB0e053QNYFqOBouTMO/k5sID4MvCiUCvv8b9M4h32wIA==
@esbuild/darwin-arm64@0.28.2 sha512-n4KqkOQrraxHJcgjM1RvwbigfQKIKJVpM7xp+KsxiyUSrRdIXnt73VhrPAx0fV44hgfmIVKjxMN9J1t5jySVkw==
@esbuild/darwin-x64@0.28.2 sha512-uq6suIWYP37qzGddBKPw5QEQPi6HiLGsO7UmkpfyaYNQ3D+rN6w6WfwH+nuqcGXWvawGwxOEroO4YGnFh95azw==
@esbuild/linux-arm64@0.28.2 sha512-pW4AC0P3it8c7do9MVM4p51FzHzdM/TZrerurgRcHJ2WTa1VQ1CIq18xncfpBJw4ojkiZZrKW2yIBWBP92j6Ug==
@esbuild/linux-x64@0.28.2 sha512-4xTZr1FUmSoQW4XIWmit3tzQrUTZM+N3P0XV8xROKYF50XfI7xeO90+1bZvNwxIufQ9hDQVRJH5YhgPVF8A/HQ==
EOF
)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The destructured exports in lib/scene.js's lazy renderer import.
names="$(sed -n "/^const {/,/three.js/p" lib/scene.js | tr -d '\n' | sed -E 's/^const \{(.*)\} = await.*/\1/')"
echo "export {$names} from 'three';" > "$tmp/entry.js"
# --ignore-scripts: esbuild's install script (an optimisation only) and any script a dependency might add never run.
npm install --prefix "$tmp" --silent --no-save --no-package-lock --ignore-scripts --no-audit --no-fund \
  --registry https://registry.npmjs.org/ "three@$three_version" "esbuild@$esbuild_version"
# npm records what it installed, with the integrity of each tarball, in node_modules/.package-lock.json.
printf '%s\n' "$integrity" | node scripts/npm-integrity.js "$tmp/node_modules/.package-lock.json" - three esbuild

# From inside $tmp: the readable output names each source file by its path, which must not depend on where $tmp is.
(cd "$tmp" && node_modules/.bin/esbuild entry.js --bundle --format=esm --legal-comments=eof \
  --banner:js="// three.js $three_version (MIT, lib/three.LICENSE), only what lib/scene.js uses. Built by scripts/vendor-three.sh." \
  --outfile=three.js)
built="$(shasum -a 256 "$tmp/three.js" | cut -d' ' -f1)"
if [ "$built" != "$file_sha256" ]; then
  echo "vendor-three: the build is $built, not the recorded file_sha256 $file_sha256; lib/ is unchanged." >&2
  echo "vendor-three: if you changed the pinned versions on purpose, record the new hash in this script and rerun." >&2
  exit 1
fi
cp "$tmp/three.js" lib/three.js
cp "$tmp/node_modules/three/LICENSE" lib/three.LICENSE

echo "lib/three.js: three $three_version ($(du -h lib/three.js | cut -f1)), sha256 $built"
