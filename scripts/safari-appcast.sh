#!/bin/sh
# Release operator only: validates an already notarized DMG, signs its enclosure with
# Sparkle's Keychain EdDSA key, and writes a local appcast. Does not upload or publish.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 - "$root" "$@" <<'PY'
import base64
from datetime import datetime, timezone
from email.utils import format_datetime
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

if len(sys.argv) != 4:
    sys.exit('usage: sh scripts/safari-appcast.sh <notarized-dmg> <Sparkle-bin-directory>')
root, dmg, tools = map(lambda p: Path(p).resolve(), sys.argv[1:])
version = json.loads((root / 'manifest.json').read_text())['version']
if dmg.name != f'glaze-{version}-safari-macos.dmg' or not dmg.is_file():
    sys.exit('safari-appcast: expected existing notarized glaze-<manifest-version>-safari-macos.dmg')
for tool in ('generate_keys', 'sign_update'):
    if not os.access(tools / tool, os.X_OK):
        sys.exit('safari-appcast: use the bin directory from the pinned Sparkle 2.10.0 distribution')
# All metadata/notarization checks precede any Keychain lookup or signing.
subprocess.run(['xcrun', 'stapler', 'validate', str(dmg)], check=True)
subprocess.run(['spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', str(dmg)], check=True)
with tempfile.TemporaryDirectory(prefix='glaze-appcast-') as temp:
    mount = Path(temp) / 'mount'
    mount.mkdir()
    subprocess.run(['hdiutil', 'attach', '-quiet', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(dmg)], check=True)
    try:
        app = mount / 'Glaze.app'
        with (app / 'Contents/Info.plist').open('rb') as f:
            info = plistlib.load(f)
        if (info.get('CFBundleIdentifier') != 'io.frostdev.Glaze'
                or info.get('CFBundleShortVersionString') != version or info.get('CFBundleVersion') != version):
            sys.exit('safari-appcast: app identity or build/marketing version does not match the manifest')
        public = info.get('SUPublicEDKey', '')
        try:
            valid_key = len(base64.b64decode(public, validate=True)) == 32
        except ValueError:
            valid_key = False
        if not valid_key:
            sys.exit('safari-appcast: app has no real Sparkle public key; replace the placeholder and rebuild')
        if info.get('SUFeedURL') != 'https://frostdev.io/projects/glaze/appcast.xml':
            sys.exit('safari-appcast: unexpected appcast URL')
        if os.environ.get('SAFARI_REQUIRE_UNIVERSAL') == '1':
            for bundle in (app, app / 'Contents/PlugIns/Glaze Extension.appex'):
                with (bundle / 'Contents/Info.plist').open('rb') as f:
                    metadata = plistlib.load(f)
                if (metadata.get('CFBundleShortVersionString') != version or metadata.get('CFBundleVersion') != version):
                    sys.exit('safari-appcast: app and extension versions must match the manifest')
                binary = bundle / 'Contents/MacOS' / metadata['CFBundleExecutable']
                architectures = subprocess.check_output(['lipo', '-archs', str(binary)], text=True).split()
                if set(architectures) != {'arm64', 'x86_64'}:
                    sys.exit('safari-appcast: app and extension must both be universal arm64/x86_64')
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        subprocess.run(['xcrun', 'stapler', 'validate', str(app)], check=True)
    finally:
        subprocess.run(['hdiutil', 'detach', '-quiet', str(mount)], check=True)
    output = Path(os.environ.get('SAFARI_APPCAST_OUT', root / 'release/appcast.xml')).resolve()
    base = Path(os.environ.get('SAFARI_APPCAST_BASE', output)).resolve()
    if 'SAFARI_APPCAST_BASE' in os.environ and not base.is_file():
        sys.exit('safari-appcast: configured base feed is missing; refusing to discard history')
    ns = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
    ET.register_namespace('sparkle', ns)
    tree = ET.parse(base) if base.exists() else ET.ElementTree(ET.fromstring('<rss version="2.0"><channel><title>Glaze</title><link>https://frostdev.io/projects/glaze</link><description>Glaze for Safari updates</description></channel></rss>'))
    channels = tree.getroot().findall('channel')
    if tree.getroot().tag != 'rss' or len(channels) != 1:
        sys.exit('safari-appcast: existing feed has an unexpected structure; left unchanged')
    account = os.environ.get('SAFARI_UPDATE_KEY_ACCOUNT', 'ed25519')
    actual_public = subprocess.check_output([str(tools / 'generate_keys'), '--account', account, '-p'], text=True).strip()
    if actual_public != public:
        sys.exit('safari-appcast: Keychain public key does not match the app; no enclosure signed')
    signature = subprocess.check_output([str(tools / 'sign_update'), '--account', account, '-p', str(dmg)], text=True).strip()
    if len(base64.b64decode(signature, validate=True)) != 64:
        sys.exit('safari-appcast: sign_update did not return an EdDSA signature')
    channel = channels[0]
    for old in channel.findall('item'):
        enclosure = old.find('enclosure')
        if enclosure is not None and enclosure.get(f'{{{ns}}}version') == version:
            channel.remove(old)
    item = ET.Element('item')
    ET.SubElement(item, 'title').text = f'Glaze {version}'
    ET.SubElement(item, 'pubDate').text = format_datetime(datetime.now(timezone.utc))
    ET.SubElement(item, 'enclosure', {
        'url': f'https://github.com/frostdev-ops/glaze/releases/download/v{version}/{dmg.name}',
        f'{{{ns}}}version': version, f'{{{ns}}}shortVersionString': version,
        f'{{{ns}}}edSignature': signature, 'length': str(dmg.stat().st_size),
        'type': 'application/octet-stream'})
    channel.insert(0, item)
    ET.indent(tree, space='  ')
    output.parent.mkdir(exist_ok=True)
    staged = Path(temp) / 'appcast.xml'
    tree.write(staged, encoding='UTF-8', xml_declaration=True)
    # Same-directory temporary file makes the replacement atomic, preserving the old feed on failure.
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.appcast-', delete=False) as f:
        pending = Path(f.name)
        f.write(staged.read_bytes())
    try:
        pending.replace(output)
    finally:
        pending.unlink(missing_ok=True)
print(f'Prepared {output}; review and publish the DMG and feed separately.')
PY
