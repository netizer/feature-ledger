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

## Symbols

**Noto Sans Symbols 2** (Google, also OFL 1.1) is embedded with every edition
and named last in both font stacks. It draws the UI icons descriptions tend to
quote (✕, ✉, ★, arrows, check marks) that neither text face carries.

## Coverage

The files are the whole fonts, not subsets. Chromium subsets every embedded
face down to the glyphs a document uses when it writes the PDF, so trimming
them in advance only ever saved package bytes.

Nothing predicts coverage from the text. After the page renders,
`src/render/pdf.mjs` asks Chromium which font drew every element's text, and
if any of it fell back to a system font the build fails, naming the text and
the likely characters, rather than silently printing a glyph or two in Arial,
which is what nobody notices until the client is holding the PDF. Between them
the bundled faces cover Latin-1, Latin Extended-A and the common symbol
blocks; Cyrillic, CJK or emoji need their own faces.

## Replacing them

Drop static WOFF files in here named `<FamilyNoSpaces>-<weight>.woff`, list
them in `FONT_FACES` in `src/render/fonts.mjs`, and point
`.ledger/brand.json`'s `fonts` at the family names. Fonts named in
`brand.json` that aren't bundled don't fail — the PDF prints in whatever the
machine has, and `ledger status` warns that it will.
