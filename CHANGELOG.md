# Changelog

## 1.1.0 (2026-11-25)

- **The credit opens the project.** Click "Made with ♥ by Ibrahim Awad" to open Tab finder on GitHub,
  to star it, report a bug or suggest an idea.
- **Words per board.** A title and noun belong to one space's board (`config.json` → `spaces`, or the
  board's props), so a custom word like "agents" never leaks onto every other board. Nouns can be a
  `[singular, plural]` pair.
- **Long names stay readable.** Cards cut long names and lines to fit and show the whole text, wrapped,
  when you hover.
- **Small and short screens.** A short pane drops the greeting and tip to fit more cards; a popup on a
  short window shrinks its list so the footer stays in view.
- Fixed: a tab left "done" for over an hour made the board rewrite its state on every redraw.
- Fixed: a tab with several agents could be marked "On a loop" after a single finish.
- Fixed: the keyboard selection jumped to another tab when cards moved; it now stays on its tab.
- Fixed: moving down into a new section could leave the selected card out of view.
- Fixed: a helper agent could be counted twice in "N agents".
- Fixed: notes now match the name a card shows, and never match by Herdr's tab numbers.
- Fixed: the popup no longer suggests Esc to clear a search (Esc closes it).
- Installers: the Windows one-liner no longer closes your PowerShell window; an interrupted copy leaves
  the installed version untouched; a symlinked keys.json stays a symlink; `curl … | sh` always installs
  the release, never a stray local copy; Windows PowerShell 5.1 no longer stops on herdr-app's warnings.

## 1.0.0 (2026-11-25)

The first public release.

- A searchable board of Herdr tabs as cards, as a tab or as a popup over anything.
- Quiet by design: only tabs that need your input are highlighted. A finished agent gets a small "New
  output" mark; tabs that finish 3 or more times within an hour are marked "On a loop"; a bell mutes any
  tab.
- Cards are named exactly as Herdr's tab bar names tabs, so several "Claude Code" tabs from the + menu read
  as what each agent is doing, with the agent's own status message underneath.
- Search across names, tasks, notes, spaces and machines, ignoring case and accents, with a fuzzy
  fallback.
- Favorites, recent tabs, status filters, every space or one, other machines and offline ones.
- Keyboard first: arrows, Page Up and Down, Enter, Ctrl+S to star, Ctrl+M to mute, Esc; `pane.go`
  reaches a board pane; key commands for keys.json.
- Screen-reader labels, tooltips, light and dark themes, Herdr's zoom, narrow panes, floating blocks.
- Pages of 100 cards, so hundreds of tabs stay within Herdr's render budget.
- Optional config.json (global name and icons; a title and noun per space) and notes.json, with invalid
  files reported on the board.
- Installers for macOS and Linux (install.sh) and Windows (install.ps1): unattended, rerunnable,
  uninstall, version pinning and mirrors.
- Earlier private builds kept favorites under `tabboard.*`; they are copied to `tabfinder.*` once.
