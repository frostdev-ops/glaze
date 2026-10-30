#!/usr/bin/env python3
# Xcode registers every Mac app it builds, and a registered copy of Glaze can make Safari delete the installed Glaze's
# settings. So the Mac builds run under ids of their own, and only the copy that ships gets Glaze's back. The DMG build's
# app group goes with its ids: a build copy never shares the installed Glaze's group container.
#   safari-build-ids.py project path/to/project.pbxproj   Glaze's ids -> io.frostdev.GlazeBuild…, and the Mac targets'
#                                                         Release.entitlements app groups with them
#   safari-build-ids.py app path/to/Glaze.app             io.frostdev.GlazeBuild… -> Glaze's ids (app and extension)
#   safari-build-ids.py entitlements built.plist out.plist  a build copy's signed entitlements with Glaze's app group back,
#                                                           for build-safari.sh to sign the release with
import os, plistlib, subprocess, sys

GLAZE, BUILD = 'io.frostdev.Glaze', 'io.frostdev.GlazeBuild'
GROUPS = 'com.apple.security.application-groups'


def swap(group, old, new):
    """<team>.<old…> as <team>.<new…>, or None when the group isn't old's."""
    team, _, rest = group.partition('.')
    return f'{team}.{new}{rest[len(old):]}' if team and (rest == old or rest.startswith(old + '.')) else None


def project(path):
    # The Mac targets' entitlements, as build-safari.sh and appstore-safari.sh pass them: $(SRCROOT)/$(TARGET_NAME)/.
    folder = os.path.dirname(os.path.abspath(path))
    srcroot = os.path.dirname(folder) if folder.endswith('.xcodeproj') else None
    entitlements = {}
    for target in ('Glaze', 'Glaze Extension') if srcroot else ():
        file = os.path.join(srcroot, target, 'Release.entitlements')
        if not os.path.exists(file):
            continue
        with open(file, 'rb') as f:
            e = plistlib.load(f)
        if GROUPS in e:
            groups = [swap(g, GLAZE, BUILD) for g in e[GROUPS]]
            if not groups or None in groups:
                sys.exit(f'safari-build-ids: {file} has an app group that is not Glaze\'s: {e[GROUPS]}')
            e[GROUPS] = groups
            entitlements[file] = e
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
    for file, e in entitlements.items():
        with open(file, 'wb') as f:
            plistlib.dump(e, f)


def app(path):
    plists = ((f'{path}/Contents/Info.plist', GLAZE), (f'{path}/Contents/PlugIns/Glaze Extension.appex/Contents/Info.plist', GLAZE + '.Extension'))
    for plist, want in plists:
        with open(plist, 'rb') as f:
            info = plistlib.load(f)
        if info.get('CFBundleIdentifier') != BUILD + want[len(GLAZE):]:
            sys.exit(f"safari-build-ids: {plist} isn't a build-id copy ({info.get('CFBundleIdentifier')})")
    for plist, want in plists:
        subprocess.run(['plutil', '-replace', 'CFBundleIdentifier', '-string', want, plist], check=True)


def entitlements(built, out):
    with open(built, 'rb') as f:
        e = plistlib.load(f)
    groups = [swap(g, BUILD, GLAZE) for g in e.get(GROUPS) or []]
    if not groups or None in groups:
        sys.exit(f"safari-build-ids: {built} isn't a build-id copy's entitlements ({e.get(GROUPS)})")
    e[GROUPS] = groups
    with open(out, 'wb') as f:
        plistlib.dump(e, f)


mode, args = sys.argv[1], sys.argv[2:]
{'project': project, 'app': app, 'entitlements': entitlements}[mode](*args)
