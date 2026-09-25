import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fail } from "../util.mjs";

/*
 * Printing is done by driving a real Chromium the way a person would print a
 * styled page from their browser: real CSS, real fonts, printBackground on so
 * the tinted rows actually show up. What varies between machines is only
 * *which* Chromium, so this resolves one in the order that asks least of the
 * host project:
 *
 *   1. a full `playwright` install, if the project happens to have one
 *      (its bundled browser is the most predictable renderer);
 *   2. the Chrome or Edge already installed on the machine, driven through
 *      the `playwright-core` dependency — no 300MB download;
 *   3. an explicit binary in $LEDGER_CHROME, for a container or a CI image
 *      that ships its own headless shell.
 */
const CHANNELS = ["chrome", "msedge", "chromium"];

async function launchBrowser() {
  const tried = [];

  try {
    const pw = await import("playwright");
    return { browser: await pw.chromium.launch(), how: "playwright's bundled chromium" };
  } catch (e) {
    tried.push(`playwright: ${e.code === "ERR_MODULE_NOT_FOUND" ? "not installed" : e.message.split("\n")[0]}`);
  }

  const core = await import("playwright-core");

  if (process.env.LEDGER_CHROME) {
    return {
      browser: await core.chromium.launch({ executablePath: process.env.LEDGER_CHROME }),
      how: `$LEDGER_CHROME (${process.env.LEDGER_CHROME})`,
    };
  }

  for (const channel of CHANNELS) {
    try {
      return { browser: await core.chromium.launch({ channel }), how: `the installed ${channel}` };
    } catch (e) {
      tried.push(`${channel}: ${e.message.split("\n")[0]}`);
    }
  }

  fail(
    "couldn't find a Chromium to print with. Install Google Chrome, or run " +
    "`npx playwright install chromium` in this project, or point $LEDGER_CHROME at a browser binary.\n" +
    tried.map((t) => `  · ${t}`).join("\n"),
  );
}

/** Which browser `ledger status` reports, without printing anything. */
export async function probeBrowser() {
  const { browser, how } = await launchBrowser();
  await browser.close();
  return how;
}

/**
 * A character none of the embedded faces carry doesn't fail: Chromium quietly
 * draws it in a system font (Arial, Apple Symbols…), which nobody notices
 * until the client is holding the PDF. So ask it which fonts it actually used
 * for every element's text, and refuse to print if any isn't one the page
 * embedded. This checks the outcome, so it can't drift from the font files
 * the way a list of codepoints can, and it knows which face each run of text
 * is really set in.
 */
async function checkEmbeddedFonts(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });

  const TEXT_NODE = 3;
  const fallbacks = [];
  const walk = async (node) => {
    const text = (node.children ?? [])
      .filter((c) => c.nodeType === TEXT_NODE && c.nodeValue.trim())
      .map((c) => c.nodeValue)
      .join("");
    if (text && !["STYLE", "SCRIPT", "TITLE"].includes(node.nodeName)) {
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
      const system = fonts.filter((f) => !f.isCustomFont).map((f) => f.familyName);
      if (system.length) fallbacks.push({ system, text });
    }
    for (const c of node.children ?? []) await walk(c);
  };
  await walk(root);
  await cdp.detach();
  if (!fallbacks.length) return;

  const lines = fallbacks.map(({ system, text }) => {
    const suspects = [...new Set(text.match(/[^\x00-\x7F]/gu) ?? [])]
      .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} (${c})`)
      .join(", ");
    return `  · drawn in ${system.join(", ")}${suspects ? ` (likely ${suspects})` : ""}: "${text.trim().slice(0, 80)}…"`;
  });
  fail(
    "some text isn't covered by the bundled fonts and would print in a system font:\n" +
    `${lines.join("\n")}\n` +
    "Replace those characters in the text, or bundle a face that carries them (see assets/fonts/README.md).",
  );
}

/**
 * @param {{ checkFonts?: boolean }} opts — `checkFonts` is off when the brand
 * asked for faces this package doesn't bundle: then everything is a system
 * font by design, and the build has already warned about it.
 */
export async function htmlToPdf(html, outPath, { checkFonts = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  const htmlPath = path.join(dir, "ledger.html");
  fs.writeFileSync(htmlPath, html);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    // Fonts are embedded as data: URIs rather than fetched, so `networkidle`
    // says nothing about whether they're ready — wait for them explicitly, or
    // a page can print in the fallback face.
    await page.evaluate(() => document.fonts.ready);
    if (checkFonts) await checkEmbeddedFonts(page);

    // The printed running footer is Chromium's, not the page's — it lives in
    // the paper margin, outside the document flow, so it can't be styled from
    // the page's own stylesheet and gets no @font-face. The document supplies
    // its text via <meta name="pdf-footer-left">, which keeps this generic.
    const footerLeft = await page.evaluate(
      () => document.querySelector('meta[name="pdf-footer-left"]')?.content ?? "",
    );
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

    await page.pdf({
      path: outPath,
      format: "Letter",
      printBackground: true,
      margin: { top: "0.55in", bottom: "0.62in", left: "0.6in", right: "0.6in" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width: 100%; font-size: 7px; letter-spacing: .06em; color: #a2aab7;
                    font-family: Helvetica, Arial, sans-serif; padding: 0 0.6in;
                    display: flex; justify-content: space-between; align-items: baseline;">
          <span>${esc(footerLeft)}</span>
          <span style="font-variant-numeric: tabular-nums;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </span>
        </div>`,
    });
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return outPath;
}
