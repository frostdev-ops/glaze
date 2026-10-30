#!/bin/sh
# Recheck both sides of Node symlinks and every ancestor before executing it.
uid=$(/usr/bin/id -u)
gid=$(/usr/bin/id -g)
os=$(/usr/bin/uname -s)
LC_ALL=C
export LC_ALL
set -f
safe_path() (
  p=$1
  links=${2:-0}
  [ "$links" -le 40 ] || return 1
  case "$p" in /*) ;; *) return 1 ;; esac
  case "$p" in *[[:cntrl:]]*) return 1 ;; esac
  part=/
  rest=${p#/}
  while :; do
    if [ "$os" = Darwin ]; then
      meta=$(/usr/bin/stat -f '%u %g %Lp' "$part") || return 1
    else
      meta=$(/usr/bin/stat -c '%u %g %a' -- "$part") || return 1
    fi
    set -- $meta
    [ "$#" -eq 3 ] || return 1
    case "$1:$2:$3" in *[!0-9:]*|::*|*::*) return 1 ;; esac
    [ "$1" = 0 ] || [ "$1" = "$uid" ] || return 1
    if [ -L "$part" ]; then
      # The sentinel preserves trailing newlines so control characters fail closed.
      target=$(/usr/bin/readlink "$part" && printf .) || return 1
      target=${target%.}
      target=${target%?}
      case "$target" in /*) ;; *) target=${part%/*}/$target ;; esac
      safe_path "$target${rest:+/$rest}" "$((links + 1))"
      return $?
    fi
    mode=$((0$3))
    if ! { [ -n "$rest" ] && [ -d "$part" ] && [ "$1" = 0 ] && [ "$((mode & 01000))" -ne 0 ]; }; then
      [ "$((mode & 0002))" -eq 0 ] || return 1
      if [ "$((mode & 0020))" -ne 0 ]; then
        [ -d "$part" ] || return 1
        [ "$2" = "$gid" ] || { [ "$os" = Darwin ] && [ "$2" = 80 ]; } || return 1
      fi
    fi
    [ -n "$rest" ] || return 0
    [ -d "$part" ] || return 1
    name=${rest%%/*}
    case "$rest" in */*) rest=${rest#*/} ;; *) rest= ;; esac
    part=${part%/}/$name
  done
)
