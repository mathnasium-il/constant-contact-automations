import puppeteer from "puppeteer";

export async function launchPuppeteer(headless = "new") {
  const browser = await puppeteer.launch({
    headless,
  });
  const page = await browser.newPage();
  return page;
}
