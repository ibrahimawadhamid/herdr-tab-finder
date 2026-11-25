# Security

Tab finder runs inside the Herdr app with Herdr's permissions for mods. It is written to need very little
of them:

- It reads Herdr's view of your spaces, tabs, panes, agents and machines, and its own optional
  `config.json` and `notes.json`.
- It writes only its own keys in Herdr's shared state (`tabfinder.*`).
- It acts only when you ask: it selects the space and tab you pick, closes its own popup, opens Herdr's
  own new-tab menu from its + button, makes a tab you ask for (a terminal, or an agent from the list
  Herdr's `knownAgents()` gives, started the way Herdr's + menu starts it), adds its own board to new
  spaces when you turn "In every new space" on, and opens the project page when you click the credit.
- It never reaches the network, or reads or writes other files. The one program it starts itself is your
  system's link opener (`open`, `xdg-open` or `explorer`), and only when you click its "Made with ♥"
  credit, to show the project page on GitHub.

The installers copy files into Herdr's `mods` folder and, only when asked (`--bind`), add one line to
`keys.json` after backing it up. In download mode they fetch the release archive from GitHub over HTTPS,
or from the URL you give them.

## Reporting a problem

Please report security problems privately with GitHub's "Report a vulnerability" button on this
repository's Security tab, not in a public issue. You'll get a reply as soon as possible, and a fix in a
new release with a note in CHANGELOG.md.
