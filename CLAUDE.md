# Working conventions

## To-do items

Anything deferred for later goes to a **GitHub issue** on this repository,
not to a session task list. Sessions run in ephemeral containers, so an
in-session list does not survive to the next one.

Write the issue so it can be picked up cold: what to build, and any facts
already established while investigating — with the file and line references
that back them — so the next session does not re-derive them.

## Tests

Playwright suites live in `tests/suites/*.test.js`; `tests/run.js` starts its
own static server and runs them all. CI (`.github/workflows/tests.yml`) runs
them on every push in **Chromium and WebKit** — WebKit is Safari's engine, so
every iPhone browser, and has caught bugs Chromium does not show.

```
cd tests && npm ci          # once
node tests/run.js           # all suites, Chromium (from the repo root)
node tests/run.js dup sync  # only suites whose file name contains a word
BROWSER=webkit node tests/run.js
```

In a Claude Code container, Chromium is pre-installed at
`/opt/pw-browsers/chromium` and `tests/lib.js` uses it automatically; WebKit
is not, so WebKit results come from CI. Run the suites before every push,
and add or update a suite with each change — they are the only regression net
this app has. A new suite uses `launch`, `BASE` and `reporter` from
`tests/lib.js`, prints the `N/M checks passed` line, and exits non-zero on any
failure.

