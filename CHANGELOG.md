# Changelog

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
- Optional config.json and notes.json, with invalid files reported on the board.
- Installers for macOS and Linux (install.sh) and Windows (install.ps1): unattended, rerunnable,
  uninstall, version pinning and mirrors.
- Earlier private builds kept favorites under `tabboard.*`; they are copied to `tabfinder.*` once.
