#!/usr/bin/env python3
"""Create AMO reviewer source, or reproduce the exact upload from a fresh extraction."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def git(repo, *args, **kwargs):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True, **kwargs).rstrip('\n')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalize(file):
    target = file.with_suffix('.normalized.zip')
    with zipfile.ZipFile(file) as original, zipfile.ZipFile(target, 'w') as rebuilt:
        assert len(original.namelist()) == len(set(original.namelist())), 'Duplicate ZIP entries'
        for name in sorted(original.namelist()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = ((0o40755 if name.endswith('/') else 0o100644) << 16)
            if name.endswith('/'):
                entry.external_attr |= 0x10
            rebuilt.writestr(entry, original.read(name), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    target.replace(file)


def create(repo, upload, output):
    normalize(upload)
    with zipfile.ZipFile(upload) as z:
        provenance = {
            'firefox_commit': git(repo, 'rev-parse', 'HEAD'),
            'source_tree': git(repo, 'rev-parse', 'HEAD^{tree}'),
            'commit_raw': subprocess.check_output(['git', '-C', str(repo), 'cat-file', 'commit', 'HEAD'], text=True),
            'upload_filename': upload.name,
            'upload_sha256': sha(upload.read_bytes()),
            'entries': {i.filename: sha(z.read(i.filename)) for i in z.infolist()},
        }
    readme = '''Glaze Firefox reviewer source

source/ is the exact Git snapshot used to package this version, including the permanent
Firefox compatibility branch and the release source merged in an isolated clone.
reviewer/provenance.json records its commit, tree and upload hashes.

Requirements: Git 2.29+, Node.js 22+, Python 3, Bash, zip and unzip (macOS or Linux).
From a fresh extraction of this ZIP, run:

    python3 reviewer/rebuild.py verify

This reconstructs the exact shallow Git snapshot under source/, checks its tree and
commit, runs the normal release packager, normalizes ZIP metadata without changing
extension bytes, and checks every entry and the full upload SHA-256. It requires no
credentials, browser profile, npm install or network access. Python/zlib differences
may change compressed bytes; per-entry hashes are checked before the whole ZIP hash.

Bundled libraries and licenses are under source/lib/. To independently regenerate
vendored libraries in a separate fresh extraction, run the pinned scripts in source/:

    bash scripts/vendor-pdfjs.sh
    bash scripts/vendor-three.sh
    bash scripts/vendor-lottie.sh
    bash scripts/vendor-tesseract.sh

Vendor regeneration needs npm/curl and network access. Those scripts document the
local PDF imports, Firefox compatibility shims, custom three.js build, official
Lottie light-canvas distribution, and pinned OCR models. Then run the verification
command above: changed source bytes fail the tree check.

Local tests and lint do not establish live Firefox desktop/Android acceptance.
Source submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
'''
    with tempfile.TemporaryDirectory() as stage:
        archive = Path(stage) / 'source.zip'
        git(repo, 'archive', '--format=zip', '--prefix=source/', '-o', str(archive), 'HEAD')
        with zipfile.ZipFile(archive) as source, zipfile.ZipFile(output, 'w') as result:
            for info in source.infolist():
                result.writestr(info, source.read(info.filename))
            result.writestr('reviewer/provenance.json', json.dumps(provenance, indent=2) + '\n')
            result.writestr('reviewer/rebuild.py', Path(__file__).read_bytes())
            result.writestr('README.md', readme)
    print(f'Created {output}; upload SHA-256 {provenance["upload_sha256"]}')


def verify():
    base = Path(__file__).resolve().parent.parent
    repo = base / 'source'
    p = json.loads((base / 'reviewer/provenance.json').read_text())
    if (repo / '.git').exists():
        raise SystemExit('Use a fresh source extraction without an existing Git checkout.')
    git(repo, 'init', '--quiet', '--initial-branch=dev/firefox', '--object-format=sha1')
    git(repo, 'config', '--local', 'core.autocrlf', 'false')
    git(repo, 'config', '--local', 'core.hooksPath', '/dev/null')
    git(repo, 'add', '--force', '--all', '--', '.')
    assert git(repo, 'write-tree') == p['source_tree'], 'Source tree differs from declared commit'
    commit = git(repo, 'hash-object', '-w', '-t', 'commit', '--stdin', input=p['commit_raw'])
    assert commit == p['firefox_commit'], 'Commit object differs from declared commit'
    (repo / '.git/shallow').write_text(commit + '\n')
    git(repo, 'update-ref', 'refs/heads/dev/firefox', commit)
    git(repo, 'diff', '--quiet', 'HEAD', '--')
    subprocess.run(['sh', 'scripts/package-firefox.sh'], cwd=repo, check=True)
    upload = repo / 'dist' / p['upload_filename']
    normalize(upload)
    with zipfile.ZipFile(upload) as z:
        assert z.testzip() is None
        entries = {i.filename: sha(z.read(i.filename)) for i in z.infolist()}
        assert entries == p['entries'], 'Rebuilt upload entries differ from submission'
        build = json.loads(z.read('glaze-build.json'))
        assert build['commit'] == commit and not build['dirty'] and not build['development']
    assert sha(upload.read_bytes()) == p['upload_sha256'], 'ZIP compression differs; check Python/zlib versions'
    print(f'Verified {len(entries)} entries and the byte-identical Firefox upload ZIP.')


if __name__ == '__main__':
    if sys.argv[1:] == ['verify']:
        verify()
    elif len(sys.argv) == 5 and sys.argv[1] == 'create':
        create(*(Path(p).resolve() for p in sys.argv[2:]))
    else:
        raise SystemExit('usage: store-firefox-source.py create REPO UPLOAD_ZIP SOURCE_ZIP | verify')
