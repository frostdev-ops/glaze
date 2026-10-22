#!/usr/bin/env python3
# Xcode registers every Mac app it builds, and a registered copy of Glaze can make Safari delete the installed Glaze's
# settings. So the Mac builds run under ids of their own, and only the copy that ships gets Glaze's back.
#   safari-build-ids.py project path/to/project.pbxproj   Glaze's ids -> io.frostdev.GlazeBuild…
#   safari-build-ids.py app path/to/Glaze.app             io.frostdev.GlazeBuild… -> Glaze's ids (app and extension)
import plistlib, subprocess, sys

GLAZE, BUILD = 'io.frostdev.Glaze', 'io.frostdev.GlazeBuild'


def project(path):
    subprocess.run(['plutil', '-convert', 'xml1', path], check=True)
    with open(path, 'rb') as f:
        doc = plistlib.load(f)
    n = 0
    for o in doc['objects'].values():
        s = o.get('buildSettings', {})
        i = s.get('PRODUCT_BUNDLE_IDENTIFIER', '')
        if i == GLAZE or i.startswith(GLAZE + '.'):
            s['PRODUCT_BUNDLE_IDENTIFIER'] = BUILD + i[len(GLAZE):]
            n += 1
    if not n:
        sys.exit(f'safari-build-ids: no Glaze bundle ids in {path}')
    with open(path, 'wb') as f:
        plistlib.dump(doc, f)


def app(path):
    for plist, want in ((f'{path}/Contents/Info.plist', GLAZE), (f'{path}/Contents/PlugIns/Glaze Extension.appex/Contents/Info.plist', GLAZE + '.Extension')):
        with open(plist, 'rb') as f:
            info = plistlib.load(f)
        if info.get('CFBundleIdentifier') != BUILD + want[len(GLAZE):]:
            sys.exit(f"safari-build-ids: {plist} isn't a build-id copy ({info.get('CFBundleIdentifier')})")
        subprocess.run(['plutil', '-replace', 'CFBundleIdentifier', '-string', want, plist], check=True)


{'project': project, 'app': app}[sys.argv[1]](sys.argv[2])
