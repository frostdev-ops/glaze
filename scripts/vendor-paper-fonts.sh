#!/usr/bin/env bash
# Rebuild lib/fonts/: the paper fonts of Glaze Writer's paper mode, metric-compatible stand-ins for the fonts Word and
# Blackboard both have, so a line breaks in the editor where it breaks in Word on any system: Tinos (Times New Roman),
# Arimo (Arial), Carlito (Calibri) and Cousine (Courier New), each regular, bold, italic and bold italic. Latin only:
# writer-paper.css lays a local() face of the same family under them for the rest. The fonts' own licenses (SIL OFL 1.1)
# go beside them.
# Like the other vendor scripts it trusts nothing it downloads: exact versions, each tarball checked against the SHA-512
# integrity pinned below, and the result against the SHA-256 of the checked-in files. To upgrade, pick the new versions,
# copy their integrity from `npm view @fontsource/<font>@<version> dist.integrity`, run this once, and record the hashes.
# Usage: scripts/vendor-paper-fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=5.3.0
integrity=$(cat <<'EOF'
tinos sha512-VVDyyZdbcsLKxo/W7rClAvacD/7DsGc7J5xzzp51Tndib8kDkEe/0bqbb3Xb3iH6+IUjt07aRsvtQ9MGeGGi4w==
arimo sha512-nhxZ2sTVZYX8DJBgLuyX360B5vE4mxqpmjlKTRfucIqfcWRVx9vOYzWBc1IgEX0ist48VMC10PRKbFyH+4QFvQ==
cousine sha512-EhVes1KpHrmPwGVCoVxYpdiIi/L2LRGxbAuv07m3TdY76f9Vmwyhd/TNqi2RC0NOvMCNt2FtYPJcAfFfkK9DoQ==
carlito sha512-oPqvLGK/dtVzC4KjdDcV/YzQq37sZdMXxD58ADvguPo3dm6yzbBKs40ADmevJF0wLvyvJY7/fPl5YkCQ1njWUw==
EOF
)
sums=$(cat <<'EOF'
56da61898ceaf4ffec05922232ef957515d6debdae5bcb952667a46b6af5cd08  arimo-400-italic.woff2
c1f056f51c99a65aca53a0a80e71e67916dd7a8ed2423cd11f52193241440b20  arimo-400-normal.woff2
585caa2d533eff8554785869fc41a802a6865c243a83e1b5d210eb18125c032a  arimo-700-italic.woff2
181215e08de9ce411e8c9e628eea6ea8bfa45de2a955ee57fc970dd8a080a3f6  arimo-700-normal.woff2
6bbdd83c5797d207bd2027f2687a70e428513c56130feaad1ffc0a1a7ace7c07  carlito-400-italic.woff2
a29c4a4e61863753cf6a10831efaa05f849dcaa8f580422dbc41bc058c3b6b64  carlito-400-normal.woff2
e1bbd00245b0b22d0c540413ac73a91f7afff587899260a683acec3564f06ac3  carlito-700-italic.woff2
af249cfe4107221070ff077c29a043004e8f2efea977dcbaaf217a24f3b7680e  carlito-700-normal.woff2
1f797cdf757dc474a18e8b7378fb49eaab06f11c239ec40db6064cd5cb49febc  cousine-400-italic.woff2
fb542bb367b20289e71b682dc45d8f01de5b0a0658464db9053801f30e7c13a8  cousine-400-normal.woff2
7ac046711b0716288354f50cf697d61743a101507e791547cf05d24db7fbaf22  cousine-700-italic.woff2
63c3bc173bf483b579052da1a6532d84d65d0fbfdd081f1ce50d4fe895343625  cousine-700-normal.woff2
55fe58e551b07fc6586e4e632d10ebf50339fe1f0f4ec97cb55a2abc7d18ff79  tinos-400-italic.woff2
18505b57c8a016326da164a1e9a14e8d1c5081ae78e9fe7b57bb66a330ea4ef9  tinos-400-normal.woff2
6b199a846d3766e7d35961162b6dc399cda36ff60d3f26ef022be685b609425e  tinos-700-italic.woff2
4132bff0c1156d037289c3372cab59f16e4b0967b71d6cd219ce67619d02de73  tinos-700-normal.woff2
ee316340ba281306a746941edde09288dda2438879b2f30ed8ef914ec0b9079e  LICENSE-arimo.txt
da106485c940d21672382473486ea643c08be09321e6946545d2af982cdf34a8  LICENSE-carlito.txt
619e4b17e5fae2dfa490df8cda90aa04634cbcddc0ef870131097d9450119547  LICENSE-cousine.txt
af8e3086059110e7ae067c503ffa5394be76d72a68990d096629a0ad72898d54  LICENSE-tinos.txt
EOF
)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

out=lib/fonts
mkdir -p "$out"
while read -r font want; do
  url="https://registry.npmjs.org/@fontsource/$font/-/$font-$version.tgz"
  curl -fsSL "$url" -o "$tmp/$font.tgz"
  got="sha512-$(openssl dgst -sha512 -binary "$tmp/$font.tgz" | base64 | tr -d '\n')"
  [ "$got" = "$want" ] || { echo "integrity mismatch for @fontsource/$font@$version: $got" >&2; exit 1; }
  mkdir "$tmp/$font"
  tar -xzf "$tmp/$font.tgz" -C "$tmp/$font"
  for face in 400-normal 700-normal 400-italic 700-italic; do
    cp "$tmp/$font/package/files/$font-latin-$face.woff2" "$out/$font-$face.woff2"
  done
  cp "$tmp/$font/package/LICENSE" "$out/LICENSE-$font.txt"
done <<< "$integrity"

# The checked-in result, file by file.
actual=$(cd "$out" && shasum -a 256 -- *.woff2 LICENSE-*.txt)
if [ "$actual" != "$sums" ]; then
  echo "lib/fonts differs from the pinned build:" >&2
  diff <(printf '%s\n' "$sums") <(printf '%s\n' "$actual") >&2 || true
  exit 1
fi
printf '%s\n' "$actual"
