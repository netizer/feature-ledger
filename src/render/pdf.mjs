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

export async function htmlToPdf(html, outPath) {
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
