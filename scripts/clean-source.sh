# Sourced by publish-chrome.sh and release.sh (POSIX sh). The recovery tools package the committed HEAD in a fresh
# checkout, as CI does for a tag, instead of zipping a working tree that can carry edits and untracked files: a scratch
# file in lib/ would otherwise go to the Chrome Web Store, and the zip would differ from the one CI attaches.

# glaze_require_clean REPO TOOL: exit unless the working tree matches HEAD. Edits and untracked files both count;
# gitignored files (dist/, release/) do not.
glaze_require_clean() {
  _glaze_dirty=$(git -C "$1" status --porcelain --untracked-files=all) || { echo "$2: cannot read the git status of $1" >&2; exit 1; }
  if [ -n "$_glaze_dirty" ]; then
    echo "$2: the working tree has changes that are not committed, and a release is built from the commit:" >&2
    printf '%s\n' "$_glaze_dirty" | head -n 20 >&2
    echo "$2: commit or remove them, then run it again." >&2
    exit 1
  fi
}

# glaze_checkout_head REPO DIR: a fresh checkout of REPO's HEAD in DIR (a new path). Like store-release.mjs's clones it
# shares REPO's objects and runs no hooks, so it leaves REPO alone; unlike an archive it has a .git, which the tests need.
glaze_checkout_head() {
  git clone --quiet --shared --no-checkout "$1" "$2" || return 1
  git -C "$2" -c core.hooksPath=/dev/null checkout --quiet --detach "$(git -C "$1" rev-parse HEAD)"
}
