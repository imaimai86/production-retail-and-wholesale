# Review 1: add-backlog-list

Reviewed `scripts/backlog-list.cjs` (untracked, so absent from the git diff), `package.json`, the command file and the docs against `specs-1.md`. I could not run the script (shell approval denied), so findings come from reading the code.

Matches the spec: parsing, status derivation, argument errors checked before the index is read, exact error messages, table and JSON output, footer over all items, and the exports guard.

Fixed in `scripts/backlog-list.cjs`:
- **CRLF index.** Lines ending in `\r` never matched the item regex, so every item was dropped. The index is now split on `\r?\n`.
- **Unsafe slugs.** A slug containing `/`, `..` or glob characters (`*`, `?`, `[`) could read a `brief.md` outside `Docs/backlog/<slug>/`. It could also make `git branch --list sdlc/<slug>` match unrelated branches and wrongly report in-progress. Such slugs now have no brief and no branch match.

Not changed (minor): if `index.md` is a directory, `readFileSync` throws instead of exiting 1. This is outside the spec.
