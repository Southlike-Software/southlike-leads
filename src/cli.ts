#!/usr/bin/env bun
import { Command } from "commander";
import { initDatabase, closeDatabase } from "./db/schema";
import { scrapeGoogleMaps } from "./scrapers/google-maps";
import { scrapeWebsites } from "./scrapers/website";
import { scrapeLinkedIn, loginToLinkedIn } from "./scrapers/linkedin";
import { validateCreci } from "./scrapers/creci";
import { mergeDuplicates, findDuplicateCompanies } from "./services/deduplication";
import { exportToExcel } from "./export/excel";
import {
  invalidateCache,
  clearExpiredCache,
  getCacheStats,
} from "./db/cache";
import { getStats } from "./db/queries";
import { getDailyStats } from "./services/rate-limiter";
import { logger } from "./utils/logger";

const log = logger.child({ module: "cli" });

const program = new Command();

program
  .name("southlike-leads")
  .description("Real estate lead collection system for Porto Alegre")
  .version("1.0.0");

// Collect command - runs full pipeline
program
  .command("collect")
  .description("Run full lead collection pipeline")
  .option("-l, --limit <number>", "Max leads to collect", "50")
  .option("--headless", "Run browsers in headless mode", true)
  .option("--no-headless", "Run browsers with visible UI")
  .option("--skip-linkedin", "Skip LinkedIn scraping")
  .option("--skip-websites", "Skip website scraping")
  .action(async (options) => {
    const db = initDatabase();

    try {
      const limit = parseInt(options.limit);
      const headless = options.headless;

      log.info({ limit, headless }, "starting collection");

      // Step 1: Google Maps
      log.info("--- Google Maps ---");
      const gmResult = await scrapeGoogleMaps(db, { limit });
      log.info(gmResult, "Google Maps complete");

      // Step 2: Websites
      if (!options.skipWebsites) {
        log.info("--- Websites ---");
        const wsResult = await scrapeWebsites(db, { headless, limit });
        log.info(wsResult, "Websites complete");
      }

      // Step 3: LinkedIn
      if (!options.skipLinkedin) {
        log.info("--- LinkedIn ---");
        const liResult = await scrapeLinkedIn(db, { headless, limit: 20 });
        log.info(liResult, "LinkedIn complete");
      }

      // Step 4: Deduplication
      log.info("--- Deduplication ---");
      const dedupResult = mergeDuplicates(db);
      log.info({ mergedCount: dedupResult.mergedCount }, "Deduplication complete");

      log.info("collection complete - run 'export' to generate Excel");
    } finally {
      closeDatabase(db);
    }
  });

// Scrape subcommands
const scrape = program
  .command("scrape")
  .description("Run individual scrapers");

scrape
  .command("google-maps")
  .description("Scrape Google Maps for real estate agencies")
  .option("-l, --limit <number>", "Max results", "100")
  .option("--force-refresh", "Ignore cache and fetch fresh data")
  .action(async (options) => {
    const db = initDatabase();
    try {
      const result = await scrapeGoogleMaps(db, {
        limit: parseInt(options.limit),
        forceRefresh: options.forceRefresh,
      });
      console.log("\nResults:");
      console.log(`  New companies: ${result.newCount}`);
      console.log(`  Updated: ${result.updatedCount}`);
      console.log(`  Total fetched: ${result.totalFetched}`);
    } finally {
      closeDatabase(db);
    }
  });

scrape
  .command("websites")
  .description("Scrape company websites for contact info")
  .option("-l, --limit <number>", "Max websites to scrape", "50")
  .option("--headless", "Run browser in headless mode", true)
  .option("--no-headless", "Run browser with visible UI")
  .action(async (options) => {
    const db = initDatabase();
    try {
      const result = await scrapeWebsites(db, {
        headless: options.headless,
        limit: parseInt(options.limit),
      });
      console.log("\nResults:");
      console.log(`  Processed: ${result.processedCount}`);
      console.log(`  Enriched: ${result.enrichedCount}`);
    } finally {
      closeDatabase(db);
    }
  });

scrape
  .command("linkedin")
  .description("Scrape LinkedIn for decision makers")
  .option("-l, --limit <number>", "Max companies to search", "20")
  .option("--headless", "Run browser in headless mode", true)
  .option("--no-headless", "Run browser with visible UI")
  .option("--login", "Open browser for manual LinkedIn login")
  .action(async (options) => {
    if (options.login) {
      console.log("Opening browser for LinkedIn login...");
      console.log("Please log in manually. The session will be saved.");
      await loginToLinkedIn({ headless: false });
      console.log("Login complete! Session saved.");
      return;
    }

    const db = initDatabase();
    try {
      const result = await scrapeLinkedIn(db, {
        headless: options.headless,
        limit: parseInt(options.limit),
      });
      console.log("\nResults:");
      console.log(`  Companies processed: ${result.processedCount}`);
      console.log(`  Profiles found: ${result.profilesFound}`);
    } finally {
      closeDatabase(db);
    }
  });

scrape
  .command("creci")
  .description("Validate CRECI numbers (optional)")
  .option("--force-refresh", "Re-validate all CRECI numbers")
  .action(async (options) => {
    const db = initDatabase();
    try {
      const result = await validateCreci(db, {
        forceRefresh: options.forceRefresh,
      });
      console.log("\nResults:");
      console.log(`  Checked: ${result.checked}`);
      console.log(`  Verified: ${result.verified}`);
      console.log(`  Skipped: ${result.skipped}`);
    } finally {
      closeDatabase(db);
    }
  });

// Export command
program
  .command("export")
  .description("Export leads to Excel")
  .option("-o, --output <path>", "Output file path", "leads.xlsx")
  .action(async (options) => {
    const db = initDatabase();
    try {
      const result = await exportToExcel(db, options.output);
      console.log(`\nExported to ${options.output}`);
      console.log(`  Leads: ${result.leadCount}`);
      console.log(`  Interactions: ${result.interactionCount}`);
    } finally {
      closeDatabase(db);
    }
  });

// Stats command
program
  .command("stats")
  .description("Show database statistics")
  .action(async () => {
    const db = initDatabase();
    try {
      const stats = getStats(db);
      const cacheStats = getCacheStats(db);
      const rateStats = getDailyStats();

      console.log("\n=== Database Stats ===");
      console.log(`Companies: ${stats.total_companies}`);
      console.log(`Decision Makers: ${stats.total_decision_makers}`);
      console.log(`Interactions: ${stats.total_interactions}`);

      console.log("\n--- By Status ---");
      for (const [status, count] of Object.entries(stats.by_status)) {
        console.log(`  ${status}: ${count}`);
      }

      console.log("\n--- By Source ---");
      for (const [source, count] of Object.entries(stats.by_source)) {
        console.log(`  ${source}: ${count}`);
      }

      console.log("\n=== Cache Stats ===");
      console.log(`Total entries: ${cacheStats.total_entries}`);
      console.log(`Expired: ${cacheStats.expired_count}`);
      for (const [source, count] of Object.entries(cacheStats.by_source)) {
        console.log(`  ${source}: ${count}`);
      }

      console.log("\n=== Rate Limits (Today) ===");
      for (const [source, data] of Object.entries(rateStats)) {
        const limitStr = data.limit ? `/${data.limit}` : "";
        const remainStr = data.remaining !== null ? ` (${data.remaining} left)` : "";
        console.log(`  ${source}: ${data.count}${limitStr}${remainStr}`);
      }
    } finally {
      closeDatabase(db);
    }
  });

// Deduplicate command
program
  .command("dedupe")
  .description("Find and merge duplicate companies")
  .option("--dry-run", "Only show duplicates, don't merge")
  .action(async (options) => {
    const db = initDatabase();
    try {
      if (options.dryRun) {
        const groups = findDuplicateCompanies(db);
        console.log(`\nFound ${groups.length} duplicate groups:\n`);
        for (const group of groups) {
          console.log(`Primary: ${group.primary.name}`);
          console.log(`  Match reason: ${group.matchReason}`);
          for (const dup of group.duplicates) {
            console.log(`  - ${dup.name}`);
          }
          console.log();
        }
      } else {
        const result = mergeDuplicates(db);
        console.log(`\nMerged ${result.mergedCount} duplicates`);
      }
    } finally {
      closeDatabase(db);
    }
  });

// Clear cache command
program
  .command("clear-cache")
  .description("Clear scraper cache")
  .option("-s, --source <source>", "Only clear specific source cache")
  .option("--expired", "Only clear expired entries")
  .action(async (options) => {
    const db = initDatabase();
    try {
      let cleared: number;
      if (options.expired) {
        cleared = clearExpiredCache(db);
        console.log(`Cleared ${cleared} expired cache entries`);
      } else {
        cleared = invalidateCache(db, options.source);
        const scope = options.source || "all";
        console.log(`Cleared ${cleared} cache entries (${scope})`);
      }
    } finally {
      closeDatabase(db);
    }
  });

program.parse();

