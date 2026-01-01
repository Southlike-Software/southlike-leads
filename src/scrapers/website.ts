import { Database } from "bun:sqlite";
import { chromium, type Browser, type Page } from "playwright";
import { createChildLogger } from "../utils/logger";
import { getCacheEntry, setCacheEntry } from "../db/cache";
import {
  getCompaniesWithoutWebsiteScrape,
  updateCompany,
  insertDecisionMaker,
  findDecisionMakersByCompany,
} from "../db/queries";
import {
  waitForRateLimit,
  canMakeRequest,
  recordRequest,
} from "../services/rate-limiter";
import { analyzeWebsiteContent } from "../services/ai-analyzer";
import { normalizeEmail, normalizePhone } from "../utils/normalize";
import type { ExtractedContact, Company } from "../schemas";

const log = createChildLogger("website-scraper");

const fetchPageContent = async (
  page: Page,
  url: string
): Promise<string | null> => {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for JS rendering

    return await page.content();
  } catch (error) {
    log.error({ url, error }, "failed to fetch page");
    return null;
  }
};

const findContactPage = async (page: Page): Promise<string | null> => {
  const contactLinkSelectors = [
    'a[href*="contato"]',
    'a[href*="contact"]',
    'a:has-text("Contato")',
    'a:has-text("Fale Conosco")',
    'a:has-text("Entre em Contato")',
  ];

  for (const selector of contactLinkSelectors) {
    try {
      const link = await page.$(selector);
      if (link) {
        const href = await link.getAttribute("href");
        if (href) {
          // Convert relative URL to absolute
          const base = new URL(page.url());
          return new URL(href, base).href;
        }
      }
    } catch {
      // Continue to next selector
    }
  }

  return null;
};

const scrapeCompanyWebsite = async (
  browser: Browser,
  company: Company
): Promise<ExtractedContact | null> => {
  if (!company.website) return null;

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    log.info({ company: company.name, url: company.website }, "scraping website");

    // Fetch homepage
    const homepageHtml = await fetchPageContent(page, company.website);
    if (!homepageHtml) return null;

    // Try to find and fetch contact page
    const contactPageUrl = await findContactPage(page);
    let contactPageHtml = "";
    if (contactPageUrl && contactPageUrl !== company.website) {
      const html = await fetchPageContent(page, contactPageUrl);
      if (html) contactPageHtml = html;
    }

    // Combine content for analysis
    const combinedHtml = homepageHtml + "\n\n" + contactPageHtml;

    // Use AI to extract contact info
    const extracted = await analyzeWebsiteContent(combinedHtml, company.website);
    return extracted;
  } finally {
    await page.close();
  }
};

export const scrapeWebsites = async (
  db: Database,
  options: { headless?: boolean; limit?: number } = {}
): Promise<{ processedCount: number; enrichedCount: number }> => {
  const { headless = true, limit = 50 } = options;

  const companies = getCompaniesWithoutWebsiteScrape(db).slice(0, limit);

  if (companies.length === 0) {
    log.info("no companies to scrape websites for");
    return { processedCount: 0, enrichedCount: 0 };
  }

  log.info({ count: companies.length }, "starting website scrape");

  const browser = await chromium.launch({ headless });
  let processedCount = 0;
  let enrichedCount = 0;

  try {
    for (const company of companies) {
      if (!canMakeRequest("website")) {
        log.warn("rate limit reached");
        break;
      }

      // Check cache
      const cached = getCacheEntry<ExtractedContact>(
        db,
        "website",
        company.website!
      );
      if (cached) {
        log.debug({ company: company.name }, "using cached website data");
        const enriched = await processExtractedContact(db, company, cached);
        if (enriched) enrichedCount++;
        processedCount++;
        continue;
      }

      await waitForRateLimit("website");
      recordRequest("website");

      const extracted = await scrapeCompanyWebsite(browser, company);
      if (extracted) {
        setCacheEntry(db, "website", company.website!, extracted);
        const enriched = await processExtractedContact(db, company, extracted);
        if (enriched) enrichedCount++;
      }

      processedCount++;
    }
  } finally {
    await browser.close();
  }

  log.info({ processedCount, enrichedCount }, "website scrape complete");
  return { processedCount, enrichedCount };
};

const processExtractedContact = async (
  db: Database,
  company: Company,
  extracted: ExtractedContact
): Promise<boolean> => {
  let enriched = false;
  const updates: Partial<Company> = {};

  // Update company with extracted data
  if (extracted.emails.length > 0 && !company.email) {
    updates.email = normalizeEmail(extracted.emails[0]);
    enriched = true;
  }

  if (extracted.phones.length > 0 && !company.phone) {
    updates.phone = normalizePhone(extracted.phones[0]);
    enriched = true;
  }

  if (extracted.social.instagram && !company.social_instagram) {
    updates.social_instagram = extracted.social.instagram;
    enriched = true;
  }

  if (extracted.social.facebook && !company.social_facebook) {
    updates.social_facebook = extracted.social.facebook;
    enriched = true;
  }

  if (extracted.social.linkedin && !company.social_linkedin) {
    updates.social_linkedin = extracted.social.linkedin;
    enriched = true;
  }

  if (extracted.creci && !company.creci_number) {
    updates.creci_number = extracted.creci;
    enriched = true;
  }

  if (Object.keys(updates).length > 0) {
    updateCompany(db, company.id!, updates);
    log.debug({ company: company.name, updates }, "updated company from website");
  }

  // Add decision makers
  const existingDMs = findDecisionMakersByCompany(db, company.id!);
  const existingNames = new Set(existingDMs.map((dm) => dm.name.toLowerCase()));

  for (const person of extracted.people) {
    if (existingNames.has(person.name.toLowerCase())) continue;

    insertDecisionMaker(db, {
      company_id: company.id!,
      name: person.name,
      title: person.title,
      email: person.email ? normalizeEmail(person.email) : undefined,
      phone: person.phone ? normalizePhone(person.phone) : undefined,
      source: "website",
    });

    log.debug(
      { company: company.name, person: person.name },
      "added decision maker from website"
    );
    enriched = true;
  }

  return enriched;
};

