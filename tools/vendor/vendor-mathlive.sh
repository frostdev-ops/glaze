#!/usr/bin/env bash
# Copy the official readable MathLive distribution, verifying the complete release before extracting any files.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
curl -fsSL https://registry.npmjs.org/mathlive/-/mathlive-0.111.4.tgz -o "$stage/package.tgz"
node - "$stage/package.tgz" <<'JS'
const fs=require('node:fs'),crypto=require('node:crypto');
const expected='sha512-1E5EOQnUHWn+KfEXaDTmuyxRWZrZw4WlQFyZLzJmjKEPdaX4WAnFqVfZb36mhulykcIl7/W7gKkTmutP2/9wjQ==';
const got='sha512-'+crypto.createHash('sha512').update(fs.readFileSync(process.argv[2])).digest('base64');
if(got!==expected)throw Error('MathLive release integrity mismatch');
JS
tar -xzf "$stage/package.tgz" -C "$stage"
dest="$root/extension/vendor/mathlive"
mkdir -p "$dest/fonts"
cp "$stage/package/mathlive.mjs" "$stage/package/mathlive-static.css" "$stage/package/LICENSE.txt" "$dest/"
cp "$stage/package/fonts/"*.woff2 "$dest/fonts/"
node - "$dest" <<'JS'
const fs=require('node:fs'),path=require('node:path');
for(const name of ['mathlive.mjs','mathlive-static.css','LICENSE.txt']){
 const file=path.join(process.argv[2],name);
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/[ \t]+$/gm,''));
}
JS
chmod -R a+rX "$dest"
echo 'Vendored MathLive 0.111.4 with its readable runtime, math fonts and license.'
