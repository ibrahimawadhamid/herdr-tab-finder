#!/bin/sh
# Tab finder for Herdr: install, update or remove it (macOS and Linux).
#
#   sh install.sh               install or update (your config.json and notes.json are always kept)
#   sh install.sh --bind        also add a shortcut that opens it as a popup: cmd-e on macOS,
#                               ctrl-shift-g elsewhere (only if the key is free; keys.json is backed up)
#   sh install.sh --uninstall   remove it, and its shortcut (add --purge to remove config.json and notes.json)
#   sh install.sh --version     print the version this script installs
#
# Without the files beside it (curl -fsSL .../install.sh | sh), it downloads its own release from GitHub.
#
# Environment:
#   HERDR_APP_HOME     Herdr's folder (default: $XDG_CONFIG_HOME/herdr-app, else ~/.config/herdr-app)
#   TAB_FINDER_NAME    folder name to use, when "Tab finder" is taken by a different mod
#   TAB_FINDER_REF     the release tag or branch to download (default: this script's version)
#   TAB_FINDER_URL     download this .tar.gz instead (an internal mirror, say); it must hold mods/Tab finder/
#
# Exit codes: 0 done, 1 failed (an installed version is only replaced once the new files are all
# copied), 2 bad option.
set -eu

VERSION=1.2.0
REPO=ibrahimawadhamid/herdr-tab-finder

say() { printf '%s\n' "$*"; }
fail() { say "tab finder: $*" >&2; exit 1; }

bind=false; uninstall=false; purge=false
for arg in "$@"; do
  case $arg in
    --bind) bind=true ;;
    --uninstall) uninstall=true ;;
    --purge) purge=true ;;
    --version) say "$VERSION"; exit 0 ;;
    -h | --help) sed -n '2,19p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) say "tab finder: unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
[ "$purge" = true ] && [ "$uninstall" = false ] && { say "tab finder: --purge goes with --uninstall" >&2; exit 2; }
[ "$bind" = true ] && [ "$uninstall" = true ] && { say "tab finder: --bind and --uninstall don't go together" >&2; exit 2; }

app=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}
name=${TAB_FINDER_NAME:-Tab finder}
case $name in */* | "" | .*) fail "TAB_FINDER_NAME must be a plain folder name" ;; esac
dest="$app/mods/$name"
keys="$app/keys.json"
[ -d "$app" ] || fail "no Herdr app folder at $app. Open Herdr once first, or set HERDR_APP_HOME."
if [ "$(uname -s)" = Darwin ]; then key=cmd-e; else key=ctrl-shift-g; fi
action="mod.open:$name"

# python3 edits keys.json safely. On macOS, /usr/bin/python3 is only a stub until the developer tools are
# installed, and running it would open an install dialog, so it's used only when it's real.
py=""
if command -v python3 >/dev/null 2>&1; then
  if [ "$(uname -s)" != Darwin ] || [ "$(command -v python3)" != /usr/bin/python3 ] || xcode-select -p >/dev/null 2>&1; then
    py=python3
  fi
fi

# keys_edit add|remove: add the shortcut if its key is free, or remove a shortcut that opens this mod.
# Exit status: 0 changed, 3 nothing to do, anything else: refused (keys.json untouched).
keys_edit() {
  KEYS="$keys" KEY="$key" ACTION="$action" MODE="$1" "$py" - <<'PY'
import json, os, sys
path, key, action, mode = os.environ["KEYS"], os.environ["KEY"], os.environ["ACTION"], os.environ["MODE"]
path = os.path.realpath(path)  # a keys.json that links elsewhere (dotfiles) is edited where it lives
try:
    with open(path, encoding="utf-8") as f:
        keys = json.load(f)
except ValueError as e:
    sys.exit(f"keys.json isn't valid JSON ({e}); leaving it alone")
if not isinstance(keys, dict):
    sys.exit("keys.json isn't an object; leaving it alone")
if mode == "remove":
    gone = [(s, k) for s, b in keys.items() if isinstance(b, dict) for k, v in b.items() if v == action]
    if not gone:
        sys.exit(3)
    for s, k in gone:
        del keys[s][k]
        print(f"Removed the shortcut {k}.")
else:
    for section, binds in keys.items():
        if isinstance(binds, dict) and key in binds:
            if binds[key] == action:
                print(f"{key} already opens Tab finder.")
                sys.exit(3)
            sys.exit(f"{key} is already used for {binds[key]!r} ({section}); leaving keys.json alone. "
                     f"Pick another key and add \"<key>\": \"{action}\" to \"global\" yourself.")
    keys.setdefault("global", {})[key] = action
    print(f"Added {key} to open Tab finder.")
tmp = path + ".tf-new"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(keys, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
PY
}

# Edit keys.json with a backup kept only when something changed.
edit_keys() {
  if [ ! -f "$keys" ]; then say "No keys.json in $app, so no shortcut was changed."; return 0; fi
  if [ -z "$py" ]; then
    if [ "$1" = add ]; then say "To add the shortcut, put this line in the \"global\" section of $keys:"
    else say "If you added a shortcut, delete this line from $keys:"; fi
    say "  \"$key\": \"$action\","
    return 0
  fi
  backup="$keys.bak-tabfinder-$(date +%Y%m%d%H%M%S)"
  n=1; while [ -e "$backup" ]; do n=$((n + 1)); backup="$keys.bak-tabfinder-$(date +%Y%m%d%H%M%S)-$n"; done
  cp "$keys" "$backup"
  rc=0; keys_edit "$1" || rc=$?
  if [ "$1" = add ] && { [ "$rc" = 0 ] || [ "$rc" = 3 ]; }; then bound=true; fi
  if [ "$rc" = 0 ]; then
    say "keys.json was backed up to $backup."
    [ "$1" = add ] && say "Note: once keys.json is edited, Herdr treats it as yours and stops adding new default shortcuts to it."
  else
    rm -f "$backup"
    [ "$rc" = 3 ] || say "keys.json was not changed."
  fi
  return 0
}

if [ "$uninstall" = true ]; then
  [ -d "$dest" ] || fail "Tab finder isn't installed at $dest"
  if [ -f "$dest/main.js" ] && ! grep -q "Tab finder for Herdr" "$dest/main.js"; then
    fail "$dest holds a different mod; leaving it alone"
  fi
  rm -rf "$dest/icons"
  rm -f "$dest/main.js" "$dest/mod.json" "$dest/jsconfig.json" "$dest"/*.d.ts
  if [ "$purge" = true ]; then rm -f "$dest/config.json" "$dest/notes.json"; fi
  if rmdir "$dest" 2>/dev/null; then say "Removed $dest."
  else say "Removed Tab finder from $dest; kept your own files there."; fi
  edit_keys remove
  say "Favorites, mutes and recent tabs stay in Herdr's shared.json (keys tabfinder.*); delete them there while Herdr is closed if you like."
  exit 0
fi

# Where the files come from: beside this script, else a download of this version's release.
# Only a real install.sh file uses the files beside it; piped (curl ... | sh), $0 is the shell, and a
# folder that happens to hold an old copy must not be installed by mistake.
src=""
case $0 in
  *install.sh) if [ -f "$0" ] && here=$(cd "$(dirname "$0")" 2>/dev/null && pwd); then src="$here/mods/Tab finder"; fi ;;
esac
tmp=""
cleanup() {
  [ -n "$tmp" ] && rm -rf "$tmp"
  # Half-copied files from an interrupted install; the installed ones are untouched.
  [ -n "${dest:-}" ] && rm -f "$dest"/*.tf-new "$dest"/icons/*.tf-new 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM
if [ -z "$src" ] || [ ! -f "$src/main.js" ]; then
  command -v curl >/dev/null 2>&1 || fail "needs curl to download Tab finder"
  command -v tar >/dev/null 2>&1 || fail "needs tar to unpack Tab finder"
  ref=${TAB_FINDER_REF:-v$VERSION}
  url=${TAB_FINDER_URL:-https://github.com/$REPO/archive/$ref.tar.gz}
  tmp=$(mktemp -d)
  say "Downloading Tab finder ($ref)..."
  curl -fsSL "$url" -o "$tmp/tf.tar.gz" || fail "couldn't download $url"
  tar -xzf "$tmp/tf.tar.gz" -C "$tmp" || fail "the download isn't a valid archive"
  src=$(find "$tmp" -type f -path "*/mods/Tab finder/main.js" | head -n 1)
  [ -n "$src" ] || fail "the download has no mods/Tab finder/main.js"
  src=$(dirname "$src")
fi
if [ ! -f "$src/main.js" ] || [ ! -f "$src/mod.json" ] || [ ! -d "$src/icons" ]; then fail "mods/Tab finder/ is incomplete"; fi

# A folder whose main.js is someone else's is a different mod; one with no main.js is what an uninstall
# left behind (your config.json and notes.json), so it is reused.
if [ -e "$dest" ] && { [ ! -d "$dest" ] || { [ -f "$dest/main.js" ] && ! grep -q "Tab finder for Herdr" "$dest/main.js"; }; }; then
  fail "\"$name\" is already a different mod in $app/mods. Install under another name:
  TAB_FINDER_NAME=\"Tab finder 2\" sh install.sh"
elif [ -f "$dest/main.js" ]; then
  say "Updating Tab finder in $dest (your config.json and notes.json stay as they are)."
else
  say "Installing Tab finder into $dest"
fi

# Each file goes to a temporary name, then moves into place: Herdr reloads the mod as files change and
# never sees a half-written one. main.js goes last, so it reloads with its icons already there.
# First copy everything next to its final place (a failed copy changes nothing), then move each file in.
mkdir -p "$dest/icons"
for f in "$src/icons/"*.svg; do cp "$f" "$dest/icons/$(basename "$f").tf-new" || fail "couldn't copy $(basename "$f") into $dest"; done
cp "$src/mod.json" "$dest/mod.json.tf-new" || fail "couldn't copy mod.json into $dest"
cp "$src/main.js" "$dest/main.js.tf-new" || fail "couldn't copy main.js into $dest"
for f in "$dest/icons/"*.svg.tf-new "$dest/mod.json.tf-new" "$dest/main.js.tf-new"; do mv -f "$f" "${f%.tf-new}"; done
for f in config.json notes.json; do if [ -f "$dest/$f" ]; then say "Kept your $f."; fi; done

# Check it the way Herdr does, when herdr-app is around.
checker=$(command -v herdr-app 2>/dev/null || true)
if [ -z "$checker" ] && [ -x "$HOME/.local/bin/herdr-app" ]; then checker="$HOME/.local/bin/herdr-app"; fi
if [ -n "$checker" ]; then
  if HERDR_APP_HOME="$app" "$checker" check "$dest" >/dev/null 2>&1; then say "Checked: it loads."
  else say "Warning: herdr-app check didn't pass. Run: herdr-app check \"$dest\""; fi
fi

bound=false
[ "$bind" = true ] && edit_keys add

say ""
say "Done. Tab finder $VERSION is installed. To use it:"
if [ "$bound" = true ]; then say "  * Press $key anywhere in Herdr for the popup."
elif [ "$bind" = true ]; then say "  * The shortcut wasn't added (see above); add one to keys.json yourself, or use:"
else say "  * For a shortcut, run: sh install.sh --bind   (adds $key, only if it's free)"; fi
say "  * Or keep it as a tab:  herdr-app do tab.new '{\"name\":\"Find a tab\",\"mod\":\"$name\"}'"
say "  * Or open it once:      herdr-app do mod.open '{\"name\":\"$name\"}'"
