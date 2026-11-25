# Security

Tab finder runs inside the Herdr app with Herdr's permissions for mods. It is written to need very little
of them:

- It reads Herdr's view of your spaces, tabs, panes, agents and machines, and its own optional
  `config.json` and `notes.json`.
- It writes only its own keys in Herdr's shared state (`tabfinder.*`).
- Its only actions are selecting the space and tab you pick, and closing its own popup.
- It never runs programs, reaches the network, or reads or writes other files.

The installers copy files into Herdr's `mods` folder and, only when asked (`--bind`), add one line to
`keys.json` after backing it up. In download mode they fetch the release archive from GitHub over HTTPS,
or from the URL you give them.

## Reporting a problem

Please report security problems privately with GitHub's "Report a vulnerability" button on this
repository's Security tab, not in a public issue. You'll get a reply as soon as possible, and a fix in a
new release with a note in CHANGELOG.md.
