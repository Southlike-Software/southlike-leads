import { Database } from "bun:sqlite";
import { createChildLogger } from "../utils/logger";
import { getCacheEntry, setCacheEntry } from "../db/cache";
import { getAllCompanies, updateCompany } from "../db/queries";
import { waitForRateLimit, recordRequest } from "../services/rate-limiter";

const log = createChildLogger("creci-scraper");

// CRECI-RS doesn't have a public API, so we mark this as optional/limited
// This module provides a placeholder that can be extended if access becomes available

type CreciValidationResult = {
  valid: boolean;
  name?: string;
  type?: "PF" | "PJ"; // Pessoa Física ou Jurídica
  status?: string;
};

// Placeholder - CRECI-RS doesn't have a public searchable registry
// This would need to be implemented if/when access is available
const validateCreciNumber = async (
  _creciNumber: string
): Promise<CreciValidationResult | null> => {
  // CRECI-RS (Conselho Regional de Corretores de Imóveis do Rio Grande do Sul)
  // doesn't provide a public API for validation
  //
  // Options for implementation:
  // 1. Manual verification through their website (requires login/CAPTCHA)
  // 2. Official API access (requires partnership/agreement)
  // 3. Web scraping their search (risky, may violate ToS)
  //
  // For now, we skip validation and just store the CRECI number as-is
  log.debug("CRECI validation not implemented - CRECI-RS has no public API");
  return null;
};

export const validateCreci = async (
  db: Database,
  options: { forceRefresh?: boolean } = {}
): Promise<{ checked: number; verified: number; skipped: number }> => {
  const { forceRefresh = false } = options;

  const companies = getAllCompanies(db).filter((c) => c.creci_number);

  if (companies.length === 0) {
    log.info("no companies with CRECI numbers to validate");
    return { checked: 0, verified: 0, skipped: 0 };
  }

  log.info({ count: companies.length }, "starting CRECI validation");

  let checked = 0;
  let verified = 0;
  let skipped = 0;

  for (const company of companies) {
    const creciNumber = company.creci_number!;

    // Check cache
    if (!forceRefresh) {
      const cached = getCacheEntry<CreciValidationResult>(
        db,
        "creci",
        creciNumber
      );
      if (cached) {
        if (cached.valid && !company.creci_verified) {
          updateCompany(db, company.id!, { creci_verified: true });
          verified++;
        }
        checked++;
        continue;
      }
    }

    await waitForRateLimit("creci");
    recordRequest("creci");

    const result = await validateCreciNumber(creciNumber);

    if (result === null) {
      // Validation not available
      skipped++;
      continue;
    }

    setCacheEntry(db, "creci", creciNumber, result);

    if (result.valid) {
      updateCompany(db, company.id!, { creci_verified: true });
      verified++;
    }

    checked++;
  }

  log.info({ checked, verified, skipped }, "CRECI validation complete");
  return { checked, verified, skipped };
};

// Extract CRECI number from text
export const extractCreciNumber = (text: string): string | null => {
  // Common patterns:
  // CRECI 12345
  // CRECI-RS 12345
  // CRECI/RS 12345
  // CRECI-J 12345 (Juridica)
  // CRECI 12345-J
  const patterns = [
    /CRECI[-/]?(?:RS)?[-/\s]*J?[-/\s]*(\d{3,6})[-\s]?J?/i,
    /(\d{3,6})[-\s]?(?:CRECI|J)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
};

