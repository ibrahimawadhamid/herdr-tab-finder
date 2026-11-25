# Contributing to Tab finder

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome. This guide keeps changes
easy to review and keeps Tab finder fast, quiet and private for everyone who installs it.

## Before you start

- **Found a bug?** Open an issue with the bug form: your OS, your Herdr version (`herdr-app --version`)
  and what you saw. A screenshot helps a lot.
- **Have an idea?** Open an issue with the idea form before writing code, so we can agree on the shape
  first. Small fixes can go straight to a pull request.
- **Security problem?** Don't open an issue; see [SECURITY.md](SECURITY.md).

## The rules that keep Tab finder trustworthy

1. **Private.** No network access, no telemetry, no reading or writing files outside the mod's own
   folder, and no programs, except the system's link opener when someone clicks the credit. A change that
   needs more must say so in the README and SECURITY.md, and will get a hard look.
2. **Quiet.** Only tabs that need the person's input are highlighted. New visual noise needs a strong
   reason.
3. **Generic.** No assumptions about one person's setup: no hard-coded names, spaces or machines.
   Per-person words belong in `config.json` or a board's props.
4. **Fast.** Herdr interrupts slow renders. Work out per-tab values once per render (see `label()`), never
   inside a sort comparator, and keep the 100-card pages.
5. **Native.** Use `theme()` colors (never fixed hex for UI), write sizes at zoom 1, and keep it usable
   by keyboard and screen reader (labels on icon-only controls).
6. **Compatible.** It must load on Herdr 0.1.16 and later. Guard newer APIs.

## Working on the mod

The mod is one file, `mods/Tab finder/main.js`, plus `mod.json` and `icons/`. Herdr reloads a mod the
moment you save it, so the quickest loop is to work on an installed copy:

```sh
sh install.sh                                   # copy your working tree into Herdr
herdr-app check "$HOME/.config/herdr-app/mods/Tab finder"
```

Herdr's own guide for mods is `~/.config/herdr-app/AGENTS.md`, and its APIs are in `herdr.d.ts` and
`gpui-kit.d.ts` in the same folder.

**Testing with fake agents.** You don't need real agents to see every state. A terminal becomes an agent
when it prints an OSC 7501 report; fields are colon-separated, and `msg` and `title` are base64:

```sh
# a tab whose agent is working and says what it's doing
herdr-app do tab.new "{\"name\":\"Demo\",\"argv\":[\"sh\",\"-c\",\"printf '\\\\033]7501;state=working:app=claude-code:msg=$(printf 'Refactoring auth' | base64)\\\\033\\\\\\\\'; sleep 9999\"]}"
```

States are `working`, `blocked` (add `:kind=question`), `done` and `idle`. Use made-up names only in
screenshots and tests.

**Please check before you open a pull request:**

- `herdr-app check "mods/Tab finder"` passes.
- `shellcheck -s sh install.sh` is clean, and `install.ps1` passes PSScriptAnalyzer if you touched it.
- You tried it in the app: light and dark, a narrow pane, the popup, and a space with many tabs.
- README.md and RECIPE.md still describe what the code does. RECIPE.md is the brief another agent builds
  the mod from, and the Herdr gallery shows its first paragraph, so keep it exact.
- CHANGELOG.md has a line for anything people will notice.

CI runs the same checks on Linux, macOS and Windows for every pull request.

## Pull requests

- One idea per pull request, with a short description of what changes for the person using it.
- Commit messages say what and why, in plain sentences.
- Keep the folder name `mods/Tab finder`: Herdr shows it as the pane title, and `mod.open:Tab finder` in
  people's keys.json depends on it.
- By contributing, you agree your work is released under the [MIT license](LICENSE).

## Releases

Bump `VERSION` in `main.js`, `install.sh` and `install.ps1`, add a `## X.Y.Z (date)` section to
CHANGELOG.md, then push a signed tag `vX.Y.Z`. The release workflow checks that all four agree and
publishes the GitHub release with that changelog section. The installers download the tag matching their
own version, so a release reaches people the moment it's published.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
