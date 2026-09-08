# Bundled fonts

**Inter** (Rasmus Andersson) and **Source Serif 4** (Adobe) — both under the
SIL Open Font License 1.1, which permits bundling and redistribution.

These are **static instances**, one file per weight the ledger uses. That's
deliberate, and it's the non-obvious part:

Chromium exports a *variable*-font instance to PDF as a Type 3 font — glyphs
drawn as little procedures under a custom encoding. It looks identical on the
page and prints fine, but text copied out of the finished PDF comes back
shredded, because the viewer is reverse-engineering characters from drawing
operations. Static instances embed as CID TrueType with an Identity-H
encoding, which is a real character mapping, and copy out as the words they
are.

Google Fonts serves the variable file to any modern browser, so getting the
static weights means asking with an older User-Agent:

```
curl -H 'User-Agent: Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0' \
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
```

## Coverage

`coverage.json` is the set of codepoints every bundled face can draw,
generated from the files' own `cmap` tables — never edited by hand:

```
node scripts/font-coverage.mjs
```

Between them the two families cover Latin-1 and Latin Extended-A, so European
names and prose (Polish, Czech, Turkish, the Nordic languages) print and copy
correctly. Anything outside that — Greek, Cyrillic, CJK — fails the build with
a named list of characters rather than silently falling back to Arial for a
glyph or two, which is what nobody notices until the client is holding the
PDF.

## Replacing them

Drop static WOFF files in here named `<FamilyNoSpaces>-<weight>.woff`, list
them in `FONT_FACES` in `src/render/fonts.mjs`, re-run the coverage script,
and point `.ledger/brand.json`'s `fonts` at the family names. Fonts named in
`brand.json` that aren't bundled don't fail — the PDF prints in whatever the
machine has, and `ledger status` warns that it will.
