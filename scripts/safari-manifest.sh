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
# Safari grants sites one by one in its own settings, so it keeps 3.3.8's access: every host, Ultra's entry on /ultra
# anywhere, and the detector (lib/detect.js) on every other https page, which asks before Glaze runs there.
manifest['host_permissions'] = ['<all_urls>']
manifest.pop('optional_host_permissions', None)
manifest['permissions'] = [p for p in manifest['permissions'] if p not in ('activeTab', 'declarativeContent')]
scripts = manifest['content_scripts']
for i, entry in enumerate(scripts):
    if 'content-ultra.js' in entry['js']:
        rest = {k: v for k, v in entry.items() if k not in ('matches', 'js', 'exclude_matches')}
        scripts[i] = {'matches': ['https://*/ultra', 'https://*/ultra/*'], 'js': entry['js'], 'exclude_matches': ['https://*.instructure.com/*'], **rest}
    elif 'https://*.moodlecloud.com/*' in entry['matches']:
        entry['exclude_matches'] = ['https://*/ultra', 'https://*/ultra/*']
if not any(entry['js'] == ['lib/detect.js'] for entry in scripts):
    at = max(i for i, entry in enumerate(scripts) if entry['js'][-1] == 'content.js') + 1
    scripts.insert(at, {'matches': ['https://*/*'], 'exclude_matches': ['https://*/ultra', 'https://*/ultra/*', 'https://*.instructure.com/*', 'https://*.moodlecloud.com/*'], 'js': ['lib/detect.js'], 'run_at': 'document_start'})
open(path, 'w').write(json.dumps(manifest, indent=2) + '\n')
PY
