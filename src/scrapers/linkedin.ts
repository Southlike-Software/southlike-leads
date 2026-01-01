import { Database } from "bun:sqlite";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { createChildLogger } from "../utils/logger";
import { getCacheEntry, setCacheEntry } from "../db/cache";
import {
  getCompaniesWithoutLinkedInScrape,
  insertDecisionMaker,
  findDecisionMakerByLinkedIn,
  getAllCompanies,
} from "../db/queries";
import {
  waitForRateLimit,
  canMakeRequest,
  recordRequest,
  getRemainingRequests,
} from "../services/rate-limiter";
import { normalizeLinkedInUrl } from "../utils/normalize";
import type { LinkedInProfile } from "../schemas";

const log = createChildLogger("linkedin-scraper");

const SESSION_DIR = "data/linkedin-session";

// Decision-maker title keywords
const TITLE_KEYWORDS = [
  "diretor",
  "director",
  "sócio",
  "partner",
  "owner",
  "proprietário",
  "ceo",
  "founder",
  "fundador",
  "gerente geral",
  "general manager",
  "presidente",
  "president",
];

const ensureSessionDir = (): void => {
  Bun.spawnSync(["mkdir", "-p", SESSION_DIR]);
};

const saveSession = async (context: BrowserContext): Promise<void> => {
  const cookies = await context.cookies();
  const storage = await context.storageState();
  await Bun.write(`${SESSION_DIR}/cookies.json`, JSON.stringify(cookies));
  await Bun.write(`${SESSION_DIR}/storage.json`, JSON.stringify(storage));
  log.info("saved LinkedIn session");
};

const loadSession = async (context: BrowserContext): Promise<boolean> => {
  try {
    const cookiesFile = Bun.file(`${SESSION_DIR}/cookies.json`);
    if (await cookiesFile.exists()) {
      const cookies = await cookiesFile.json();
      await context.addCookies(cookies);
      log.info("loaded LinkedIn session from file");
      return true;
    }
  } catch (error) {
    log.warn({ error }, "failed to load session");
  }
  return false;
};

const isLoggedIn = async (page: Page): Promise<boolean> => {
  try {
    // Check for LinkedIn feed or profile indicators
    const loggedInIndicators = [
      '[data-test-global-nav-link="feed"]',
      ".global-nav__me",
      ".feed-identity-module",
    ];

    for (const selector of loggedInIndicators) {
      const element = await page.$(selector);
      if (element) return true;
    }

    return false;
  } catch {
    return false;
  }
};

export const loginToLinkedIn = async (
  options: { headless?: boolean } = {}
): Promise<void> => {
  const { headless = false } = options;

  ensureSessionDir();

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    // Try to load existing session
    const hasSession = await loadSession(context);

    await page.goto("https://www.linkedin.com/feed", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    if (hasSession && (await isLoggedIn(page))) {
      log.info("already logged in with saved session");
      await saveSession(context);
      return;
    }

    // Need manual login
    log.info("waiting for manual LinkedIn login...");
    log.info("please log in to LinkedIn in the browser window");

    await page.goto("https://www.linkedin.com/login", { waitUntil: "networkidle" });

    // Wait for user to log in (up to 5 minutes)
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5s intervals

    while (attempts < maxAttempts) {
      await page.waitForTimeout(5000);
      attempts++;

      if (await isLoggedIn(page)) {
        log.info("login successful!");
        await saveSession(context);
        return;
      }

      if (attempts % 6 === 0) {
        log.info(`still waiting for login... (${attempts * 5}s elapsed)`);
      }
    }

    throw new Error("Login timeout - please log in within 5 minutes");
  } finally {
    await browser.close();
  }
};

const searchCompanyEmployees = async (
  page: Page,
  companyName: string
): Promise<LinkedInProfile[]> => {
  const profiles: LinkedInProfile[] = [];

  try {
    // Search for company
    const searchQuery = encodeURIComponent(`${companyName} Porto Alegre`);
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${searchQuery}&origin=GLOBAL_SEARCH_HEADER`;

    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Get search results
    const resultCards = await page.$$(".entity-result__item");

    for (const card of resultCards.slice(0, 10)) {
      try {
        const nameEl = await card.$(".entity-result__title-text a span[aria-hidden='true']");
        const titleEl = await card.$(".entity-result__primary-subtitle");
        const linkEl = await card.$(".entity-result__title-text a");

        const name = nameEl ? await nameEl.innerText() : null;
        const title = titleEl ? await titleEl.innerText() : null;
        const profileUrl = linkEl ? await linkEl.getAttribute("href") : null;

        if (!name || !profileUrl) continue;

        // Check if title matches decision-maker keywords
        const titleLower = (title || "").toLowerCase();
        const isDecisionMaker = TITLE_KEYWORDS.some((keyword) =>
          titleLower.includes(keyword)
        );

        if (!isDecisionMaker && title) continue; // Skip non-decision-makers

        profiles.push({
          name: name.trim(),
          title: title?.trim(),
          profile_url: normalizeLinkedInUrl(profileUrl.split("?")[0]),
          company_name: companyName,
        });
      } catch {
        // Skip problematic cards
      }
    }
  } catch (error) {
    log.error({ companyName, error }, "failed to search company employees");
  }

  return profiles;
};

export const scrapeLinkedIn = async (
  db: Database,
  options: { headless?: boolean; limit?: number } = {}
): Promise<{ processedCount: number; profilesFound: number }> => {
  const { headless = true, limit = 20 } = options;

  const remaining = getRemainingRequests("linkedin");
  if (remaining !== null && remaining <= 0) {
    log.warn("daily LinkedIn limit reached");
    return { processedCount: 0, profilesFound: 0 };
  }

  ensureSessionDir();

  const companies = getCompaniesWithoutLinkedInScrape(db).slice(
    0,
    Math.min(limit, remaining ?? limit)
  );

  if (companies.length === 0) {
    log.info("no companies to scrape LinkedIn for");
    return { processedCount: 0, profilesFound: 0 };
  }

  log.info({ count: companies.length }, "starting LinkedIn scrape");

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  // Load session
  const hasSession = await loadSession(context);
  if (!hasSession) {
    log.error("no LinkedIn session found - run 'bun cli.ts scrape linkedin --login' first");
    await browser.close();
    return { processedCount: 0, profilesFound: 0 };
  }

  const page = await context.newPage();
  let processedCount = 0;
  let profilesFound = 0;

  try {
    // Verify login
    await page.goto("https://www.linkedin.com/feed", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    if (!(await isLoggedIn(page))) {
      log.error("LinkedIn session expired - please login again");
      return { processedCount: 0, profilesFound: 0 };
    }

    for (const company of companies) {
      if (!canMakeRequest("linkedin")) {
        log.warn("LinkedIn rate limit reached");
        break;
      }

      // Check cache
      const cached = getCacheEntry<LinkedInProfile[]>(
        db,
        "linkedin",
        company.name
      );
      if (cached) {
        log.debug({ company: company.name }, "using cached LinkedIn data");
        const added = processLinkedInProfiles(db, company.id!, cached);
        profilesFound += added;
        processedCount++;
        continue;
      }

      await waitForRateLimit("linkedin");
      recordRequest("linkedin");

      log.info({ company: company.name }, "searching LinkedIn");
      const profiles = await searchCompanyEmployees(page, company.name);

      if (profiles.length > 0) {
        setCacheEntry(db, "linkedin", company.name, profiles);
        const added = processLinkedInProfiles(db, company.id!, profiles);
        profilesFound += added;
      } else {
        // Cache empty result too
        setCacheEntry(db, "linkedin", company.name, []);
      }

      processedCount++;
    }

    // Save updated session
    await saveSession(context);
  } finally {
    await browser.close();
  }

  log.info({ processedCount, profilesFound }, "LinkedIn scrape complete");
  return { processedCount, profilesFound };
};

const processLinkedInProfiles = (
  db: Database,
  companyId: string,
  profiles: LinkedInProfile[]
): number => {
  let added = 0;

  for (const profile of profiles) {
    const existing = findDecisionMakerByLinkedIn(db, profile.profile_url);
    if (existing) continue;

    insertDecisionMaker(db, {
      company_id: companyId,
      name: profile.name,
      title: profile.title,
      linkedin_url: profile.profile_url,
      source: "linkedin",
    });

    log.debug(
      { name: profile.name, title: profile.title },
      "added decision maker from LinkedIn"
    );
    added++;
  }

  return added;
};

