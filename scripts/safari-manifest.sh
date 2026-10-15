#!/bin/sh
# Rewrites a copy of manifest.json for Safari, in place. Safari rejects options_ui.open_in_tab and
# doesn't support use_dynamic_url; the App Store caps the description at 112 characters.
set -eu
python3 - "$1" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
if 'nativeMessaging' not in manifest.setdefault('permissions', []):
    manifest['permissions'].append('nativeMessaging')
manifest.get('options_ui', {}).pop('open_in_tab', None)
manifest['description'] = 'Restyle Blackboard Ultra and Canvas: palettes, fonts, backgrounds and motion, plus handy extras.'
for entry in manifest.get('web_accessible_resources', []):
    entry.pop('use_dynamic_url', None)
open(path, 'w').write(json.dumps(manifest, indent=2) + '\n')
PY
