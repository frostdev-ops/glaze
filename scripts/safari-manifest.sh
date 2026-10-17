#!/bin/sh
# Rewrites a copy of manifest.json for Safari, in place. Safari rejects options_ui.open_in_tab and
# doesn't support use_dynamic_url; the App Store caps the description at 112 characters. Safari has no
# identity API, so Google Calendar sync's oauth2 key and optional identity permission go (S3 §4).
# Code mods need Chrome: the sandbox page, its CSP and its files (mods/, beside the manifest) go too;
# content.js starts code mods only where the manifest has the sandbox. Declarative widgets stay (features/modwidgets.js,
# drawn by features/modui.js).
set -eu
dir=$(CDPATH= cd -- "$(dirname "$1")" && pwd)
[ "$dir" = "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)" ] || rm -rf "$dir/mods" "$dir/features/mods.js" # a staged copy, never the checkout
python3 - "$1" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
if 'nativeMessaging' not in manifest.setdefault('permissions', []):
    manifest['permissions'].append('nativeMessaging')
manifest.get('options_ui', {}).pop('open_in_tab', None)
manifest.pop('oauth2', None)
optional = [p for p in manifest.get('optional_permissions', []) if p != 'identity']
if optional:
    manifest['optional_permissions'] = optional
else:
    manifest.pop('optional_permissions', None)
manifest['description'] = 'Restyle Blackboard Ultra, Canvas and Moodle: palettes, fonts, backgrounds and motion, plus handy extras.'
for entry in manifest.get('web_accessible_resources', []):
    entry.pop('use_dynamic_url', None)
manifest.pop('sandbox', None)
manifest.get('content_security_policy', {}).pop('sandbox', None)
manifest['web_accessible_resources'] = [e for e in ({**e, 'resources': [r for r in e['resources'] if not r.startswith('mods/')]} for e in manifest.get('web_accessible_resources', [])) if e['resources']]
open(path, 'w').write(json.dumps(manifest, indent=2) + '\n')
PY
