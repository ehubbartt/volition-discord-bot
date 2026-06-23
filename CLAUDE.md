# Repository guidance for AI coding sessions

## Authoring & naming conventions (important)

The maintainer does **not** want "Claude" — or any AI/model name — surfaced in this
repository or its Git/GitHub history. Apply this in **every** session:

- **Commit author/committer:** use the maintainer's git identity
  (`Ethan Hubbartt <ehubbartt@gmail.com>`). Never author or co-author commits as
  "Claude", "Anthropic", or any model name.
- **No attribution trailers:** do not add `Co-Authored-By: Claude`,
  `🤖 Generated with Claude Code`, `Claude-Session`, or similar lines to commit
  messages or PR bodies. `.claude/settings.json` disables these automatically —
  leave it in place.
- **Branch names:** topical names that describe the feature
  (e.g. `editable-command-messages`). Never include "claude".
- **PR titles & bodies:** describe the change only — no "Claude"/AI mentions.
- **Code, comments, and docs:** no "Claude"/AI mentions anywhere in committed content.

The only exception is this `CLAUDE.md` file and the `.claude/` directory themselves,
whose names are fixed by the tooling that loads them.

## Delivery notes

- One topical branch + one PR per feature; keep PRs free of merge conflicts.
- Don't push to someone else's branch — open a PR instead.
