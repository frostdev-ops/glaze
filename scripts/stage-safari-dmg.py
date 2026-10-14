#!/usr/bin/env python3
"""Stage the Developer ID project only; never sign, install or change the source project."""
import base64
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
if len(sys.argv) != 2:
    sys.exit('usage: python3 scripts/stage-safari-dmg.py <stage-directory>')
public_key = os.environ.get('SAFARI_UPDATE_PUBLIC_KEY', 'REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY')
if public_key != 'REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY':
    try:
        valid_key = len(base64.b64decode(public_key, validate=True)) == 32
    except ValueError:
        valid_key = False
    if not valid_key:
        sys.exit('stage-safari-dmg: SAFARI_UPDATE_PUBLIC_KEY must be a base64 32-byte EdDSA public key')
stage = Path(sys.argv[1]).resolve()
project = stage / 'Glaze'
marker = stage / '.glaze-dmg-stage-source'
if project.exists():
    if not marker.is_file() or marker.read_text() != str(root):
        sys.exit("stage-safari-dmg: destination Glaze already exists and is not this helper's stage")
    shutil.rmtree(project)
stage.mkdir(parents=True, exist_ok=True)
marker.write_text(str(root))
version = json.loads((root / 'manifest.json').read_text())['version']
shutil.copytree(root / 'safari/Glaze', project, symlinks=True)
path = project / 'Glaze.xcodeproj/project.pbxproj'
p = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(path)]))
o = p['objects']
def require(condition, message):
    if not condition:
        sys.exit('stage-safari-dmg: unexpected project structure: ' + message)

def target(name):
    matches = [v for v in o.values() if v.get('isa') == 'PBXNativeTarget' and v.get('name') == name]
    require(len(matches) == 1, name)
    return matches[0]

app = target('Glaze')
extension = target('Glaze Extension')
require(not any('Sparkle' in str(v) for v in o.values()), 'project already has Sparkle')
require(not app.get('packageProductDependencies'), 'Mac package product dependencies')
require(not o[p['rootObject']].get('packageReferences'), 'project package references')
references = [(k, v) for k, v in o.items() if v.get('isa') == 'PBXFileReference' and v.get('path') == 'AppDelegate.swift']
require(len(references) == 1 and references[0][1].get('sourceTree') == '<group>', 'AppDelegate source reference')
reference = references[0][0]
groups = [v for v in o.values() if v.get('isa') == 'PBXGroup' and v.get('path') == 'Glaze' and reference in v.get('children', [])]
require(len(groups) == 1, 'AppDelegate source group path')
sources = [o[k] for k in app['buildPhases'] if o[k]['isa'] == 'PBXSourcesBuildPhase']
require(len(sources) == 1, 'Mac source phase')
require(sum(o[k].get('fileRef') == reference for k in sources[0]['files']) == 1, 'AppDelegate source build entry')
# Stable IDs and explicit cardinality checks make project drift fail before any build/signing.
pkg, product, link = ['F17A0000000000000000000' + n for n in ('1', '2', '3')]
require(all(k not in o for k in (pkg, product, link)), 'injected IDs are in use')
o[pkg] = {'isa': 'XCRemoteSwiftPackageReference', 'repositoryURL': 'https://github.com/sparkle-project/Sparkle',
          'requirement': {'kind': 'exactVersion', 'version': '2.10.0'}}
o[product] = {'isa': 'XCSwiftPackageProductDependency', 'package': pkg, 'productName': 'Sparkle'}
o[link] = {'isa': 'PBXBuildFile', 'productRef': product}
app['packageProductDependencies'] = [product]
frameworks = [o[k] for k in app['buildPhases'] if o[k]['isa'] == 'PBXFrameworksBuildPhase']
require(len(frameworks) == 1 and frameworks[0]['files'] == [], 'Mac framework phase')
frameworks[0]['files'].append(link)
o[p['rootObject']]['packageReferences'] = [pkg]
for t in (app, extension):
    for key in o[t['buildConfigurationList']]['buildConfigurations']:
        settings = o[key]['buildSettings']
        require('SWIFT_ACTIVE_COMPILATION_CONDITIONS' not in settings, 'target Swift conditions')
        settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) GLAZE_DMG'
        settings['CURRENT_PROJECT_VERSION'] = version
        if t is app:
            require(settings.get('ENABLE_APP_SANDBOX') == 'YES', 'Mac sandbox setting')
            settings['ENABLE_APP_SANDBOX'] = 'NO'
with path.open('wb') as f:
    plistlib.dump(p, f)
entitlements = project / 'Glaze/Release.entitlements'
with entitlements.open('rb') as f:
    e = plistlib.load(f)
require(e.pop('com.apple.security.app-sandbox', None) is True, 'release sandbox entitlement')
with entitlements.open('wb') as f:
    plistlib.dump(e, f)
shutil.copyfile(root / 'safari/dmg/AppDelegate.swift', project / 'Glaze/AppDelegate.swift')
# Keep the application/menu scene, but instantiate the guide window only on a user launch.
storyboard = project / 'Glaze/Base.lproj/Main.storyboard'
tree = ET.parse(storyboard)
doc = tree.getroot()
identifier = doc.attrib.pop('initialViewController', None)
windows = doc.findall('.//windowController')
require(len(windows) == 1 and windows[0].get('id') == identifier, 'storyboard initial window')
windows[0].set('storyboardIdentifier', 'GlazeWindow')
tree.write(storyboard, encoding='UTF-8', xml_declaration=True)
info = project / 'Glaze/Info.plist'
with info.open('rb') as f:
    i = plistlib.load(f)
i.update(SUFeedURL='https://frostdev.io/projects/glaze/appcast.xml',
         SUPublicEDKey=public_key,
         SUEnableAutomaticChecks=True, SUAutomaticallyUpdate=True, SUEnableSystemProfiling=False,
         SUSendProfileInfo=False, LSUIElement=True,
         CFBundleURLTypes=[{'CFBundleURLName': 'io.frostdev.glaze-update',
                            'CFBundleURLSchemes': ['io.frostdev.glaze-update']}])
with info.open('wb') as f:
    plistlib.dump(i, f)
# Exact version plus immutable revision, reviewed together on every Sparkle bump.
resolved = project / 'Glaze.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'
resolved.parent.mkdir(parents=True, exist_ok=True)
resolved.write_text(json.dumps({'pins': [{'identity': 'sparkle', 'kind': 'remoteSourceControl',
    'location': 'https://github.com/sparkle-project/Sparkle',
    'state': {'revision': 'eef1a539a373c1f1a320624b1130fc5de7b2e100', 'version': '2.10.0'}}],
    'version': 2}, indent=2) + '\n')
resources = project / 'Glaze Extension/Resources'
shutil.rmtree(resources)
resources.mkdir()
version = json.loads((root / 'manifest.json').read_text())['version']
subprocess.run(['unzip', '-q', str(root / f'dist/glaze-v{version}.zip'), '-d', str(resources)], check=True)
subprocess.run(['sh', str(root / 'scripts/safari-manifest.sh'), str(resources / 'manifest.json')], check=True)
print(project)
