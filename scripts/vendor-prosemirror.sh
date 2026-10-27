#!/usr/bin/env bash
# Rebuild lib/pm.js and lib/pm.css: ProseMirror (MIT, lib/pm.LICENSE), the editor engine of Glaze's writer frame, as one
# readable classic script that sets GZ_PM to its packages by name (model, state, view, transform, commands, keymap,
# history, inputrules, schemaList, tables, dropcursor, gapcursor), and the packages' own stylesheets in one file. Not
# minified, which the Chrome Web Store can take for obfuscation (2026-10-26). The output is checked in, so the extension
# itself still has no build step.
# Like the other vendor scripts it trusts nothing it downloads: exact versions, install scripts off, every installed package
# checked against the SHA-512 integrity pinned below before esbuild runs, and the result against the SHA-256 of the
# checked-in files. To upgrade, pick the new versions, copy their integrity from `npm view <package>@<version> dist.integrity`
# (and their dependencies', which npm prints in node_modules/.package-lock.json), run this once, and record the new hashes.
# Usage: scripts/vendor-prosemirror.sh
set -euo pipefail
cd "$(dirname "$0")/.."

esbuild_version=0.28.2
file_sha256=7910aad44cf05e832dc227699712ca64b488ad671b658aa4cc19957a08dbbccf
css_sha256=eecf411e60757e08f3c76ed6dc544235166dcb65039bad12fe66600dd9eb3d02
packages="prosemirror-model@1.25.11 prosemirror-state@1.4.4 prosemirror-view@1.42.3 prosemirror-transform@1.12.1
prosemirror-commands@1.7.2 prosemirror-keymap@1.2.3 prosemirror-history@1.5.1 prosemirror-inputrules@1.5.1
prosemirror-schema-list@1.5.1 prosemirror-tables@1.8.5 prosemirror-dropcursor@1.8.4 prosemirror-gapcursor@1.4.1"
integrity=$(cat <<'EOF'
prosemirror-model@1.25.11 sha512-QWg9RhnpLlogAmp3p96uEFrE5txQpFynd4vhBAELkwgOCWQs/X0yCzB3/hrHqiPwf91RG5KyWq6553zs9JqIOQ==
prosemirror-state@1.4.4 sha512-6jiYHH2CIGbCfnxdHbXZ12gySFY/fz/ulZE333G6bPqIZ4F+TXo9ifiR86nAHpWnfoNjOb3o5ESi7J8Uz1jXHw==
prosemirror-view@1.42.3 sha512-oTN7EtH+CpwxU9NrwEYWd0UZ4JUx7l048l5A2Xppm4p/60isZYLnth9QVQmC3VRIvdrIWCxwZSd+Uz791G31/w==
prosemirror-transform@1.12.1 sha512-t4F5615FycnCqsX7ShTUs8+jfnwcf46kuFRvSl/3qFx2QTZ4DjgowesLHQXcFP7G//TjesqZG3WtgL7vdyVJyA==
prosemirror-commands@1.7.2 sha512-q6Q6szxqdu9Xd6EcdKsqXghu5nQdZTpB4Q9yd04WRc7/jt763e/rT60Owh0L1GYY+T46o5rD+9lEN36dZS43tw==
prosemirror-keymap@1.2.3 sha512-4HucRlpiLd1IPQQXNqeo81BGtkY8Ai5smHhKW9jjPKRc2wQIxksg7Hl1tTI2IfT2B/LgX6bfYvXxEpJl7aKYKw==
prosemirror-history@1.5.1 sha512-onlwnqKvgtFg6srZOmDOAhlAy1FIHQpOExORybX0S+DvJepE5tPALrB9iGet/2sqqqrelSnB10OoiOJqAvu2DA==
prosemirror-inputrules@1.5.1 sha512-7wj4uMjKaXWAQ1CDgxNzNtR9AlsuwzHfdFH1ygEHA2KHF2DOEaXl1CJfNPAKCg9qNEh4rum975QLaCiQPyY6Fw==
prosemirror-schema-list@1.5.1 sha512-927lFx/uwyQaGwJxLWCZRkjXG0p48KpMj6ueoYiu4JX05GGuGcgzAy62dfiV8eFZftgyBUvLx76RsMe20fJl+Q==
prosemirror-tables@1.8.5 sha512-V/0cDCsHKHe/tfWkeCmthNUcEp1IVO3p6vwN8XtwE9PZQLAZJigbw3QoraAdfJPir4NKJtNvOB8oYGKRl+t0Dw==
prosemirror-dropcursor@1.8.4 sha512-VmKxhcA6a+h5oPSYmfF1ZNeQqPbyYaIxqZsKqeYCyTlPtrjUgNaHL3P8vVaO19oqAV0zuaM/axkowZHrB1P3Tg==
prosemirror-gapcursor@1.4.1 sha512-pMdYaEnjNMSwl11yjEGtgTmLkR08m/Vl+Jj443167p9eB3HVQKhYCc4gmHVDsLPODfZfjr/MmirsdyZziXbQKw==
orderedmap@2.1.1 sha512-TvAWxi0nDe1j/rtMcWcIj94+Ffe6n7zhow33h40SKxmsmozs6dz/e+EajymfoFcHd7sxNn8yHM8839uixMOV6g==
rope-sequence@1.3.4 sha512-UT5EDe2cu2E/6O4igUr5PSFs23nvvukicWHx6GnOPlHAiiYbzNuCRQCuiUdHJQcqKalLKlrYJnjY0ySGsXNQXQ==
w3c-keyname@2.2.8 sha512-dpojBhNsCNN7T82Tm7k26A6G9ML3NkhDsnw9n/eoxSRlVBB4CEtIQ/KTCLI2Fwf3ataSXRhYFkQi3SlnFwPvPQ==
esbuild@0.28.2 sha512-HKVLS8dvII+xoKW9kmqxbRKrnWEXfJJr/FZhhJmiqIB0e053QNYFqOBouTMO/k5sID4MvCiUCvv8b9M4h32wIA==
@esbuild/darwin-arm64@0.28.2 sha512-n4KqkOQrraxHJcgjM1RvwbigfQKIKJVpM7xp+KsxiyUSrRdIXnt73VhrPAx0fV44hgfmIVKjxMN9J1t5jySVkw==
@esbuild/darwin-x64@0.28.2 sha512-uq6suIWYP37qzGddBKPw5QEQPi6HiLGsO7UmkpfyaYNQ3D+rN6w6WfwH+nuqcGXWvawGwxOEroO4YGnFh95azw==
@esbuild/linux-arm64@0.28.2 sha512-pW4AC0P3it8c7do9MVM4p51FzHzdM/TZrerurgRcHJ2WTa1VQ1CIq18xncfpBJw4ojkiZZrKW2yIBWBP92j6Ug==
@esbuild/linux-x64@0.28.2 sha512-4xTZr1FUmSoQW4XIWmit3tzQrUTZM+N3P0XV8xROKYF50XfI7xeO90+1bZvNwxIufQ9hDQVRJH5YhgPVF8A/HQ==
EOF
)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --ignore-scripts: esbuild's install script (an optimisation only) and any script a dependency might add never run.
# shellcheck disable=SC2086 # $packages is a list of exact name@version words
npm install --prefix "$tmp" --silent --no-save --no-package-lock --ignore-scripts --no-audit --no-fund \
  --registry https://registry.npmjs.org/ $packages "esbuild@$esbuild_version"
# npm records what it installed, with the integrity of each tarball, in node_modules/.package-lock.json.
names="$(for p in $packages; do echo "${p%@*}"; done)"
# shellcheck disable=SC2086
printf '%s\n' "$integrity" | node scripts/npm-integrity.js "$tmp/node_modules/.package-lock.json" - $names esbuild

# One namespace per package, by the name GZ_PM gives it.
for p in $names; do
  short="${p#prosemirror-}"
  [ "$short" = schema-list ] && short=schemaList
  echo "export * as $short from '$p';"
done > "$tmp/entry.js"

# From inside $tmp: the readable output names each source file by its path, which must not depend on where $tmp is.
# esbuild's IIFE sets a local __gzpm; the wrapper keeps the first copy if the frame loads the file twice.
(cd "$tmp" && node_modules/.bin/esbuild entry.js --bundle --format=iife --global-name=__gzpm --target=es2020 \
  --legal-comments=eof --outfile=bundle.js)
{ echo "// ProseMirror (MIT, lib/pm.LICENSE): $(echo $packages | tr ' ' ',' | sed 's/,/, /g'). Built by scripts/vendor-prosemirror.sh."
  echo "var GZ_PM = globalThis.GZ_PM || (() => {"
  cat "$tmp/bundle.js"
  echo "return __gzpm;"
  echo "})();"
  echo "GZ_PM;"; } > "$tmp/pm.js"

css="prosemirror-view/style/prosemirror.css prosemirror-tables/style/tables.css prosemirror-gapcursor/style/gapcursor.css"
{ echo "/* ProseMirror's own stylesheets (MIT, lib/pm.LICENSE), for lib/pm.js. Built by scripts/vendor-prosemirror.sh. */"
  for f in $css; do echo; echo "/* $f */"; cat "$tmp/node_modules/$f"; done; } > "$tmp/pm.css"

{ echo "ProseMirror, bundled in lib/pm.js and lib/pm.css. Each package's license, as it ships:"
  for p in $names; do
    lic="$(ls "$tmp/node_modules/$p" | grep -iE '^licen[cs]e' | head -1)"
    echo; echo "==== $p $(node -p "require('$tmp/node_modules/$p/package.json').version") ===="; echo
    cat "$tmp/node_modules/$p/$lic"
  done; } > "$tmp/pm.LICENSE"

built="$(shasum -a 256 "$tmp/pm.js" | cut -d' ' -f1)"
built_css="$(shasum -a 256 "$tmp/pm.css" | cut -d' ' -f1)"
if [ "$built" != "$file_sha256" ] || [ "$built_css" != "$css_sha256" ]; then
  echo "vendor-prosemirror: the build is pm.js $built and pm.css $built_css, not the recorded file_sha256 $file_sha256 and" >&2
  echo "vendor-prosemirror: css_sha256 $css_sha256; lib/ is unchanged. If you changed the pinned versions on purpose, record" >&2
  echo "vendor-prosemirror: the new hashes in this script and rerun." >&2
  exit 1
fi
cp "$tmp/pm.js" lib/pm.js
cp "$tmp/pm.css" lib/pm.css
cp "$tmp/pm.LICENSE" lib/pm.LICENSE

echo "lib/pm.js: ProseMirror ($(du -h lib/pm.js | cut -f1)), sha256 $built; lib/pm.css sha256 $built_css"
