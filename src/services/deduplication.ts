import { Database } from "bun:sqlite";
import { createChildLogger } from "../utils/logger";
import {
  getAllCompanies,
  updateCompany,
  findDecisionMakersByCompany,
} from "../db/queries";
import {
  normalizeCompanyName,
  normalizeUrl,
  extractDomain,
  stringSimilarity,
} from "../utils/normalize";
import type { Company, DecisionMaker } from "../schemas";

const log = createChildLogger("deduplication");

type DuplicateGroup = {
  primary: Company;
  duplicates: Company[];
  matchReason: string;
};

// Find potential duplicate companies
export const findDuplicateCompanies = (db: Database): DuplicateGroup[] => {
  const companies = getAllCompanies(db);
  const groups: DuplicateGroup[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    if (processed.has(company.id!)) continue;

    const duplicates: Company[] = [];
    let matchReason = "";

    for (let j = i + 1; j < companies.length; j++) {
      const other = companies[j];
      if (processed.has(other.id!)) continue;

      const match = isLikelyDuplicate(company, other);
      if (match) {
        duplicates.push(other);
        matchReason = match;
        processed.add(other.id!);
      }
    }

    if (duplicates.length > 0) {
      processed.add(company.id!);
      groups.push({
        primary: company,
        duplicates,
        matchReason,
      });
    }
  }

  log.info({ groupCount: groups.length }, "found duplicate groups");
  return groups;
};

const isLikelyDuplicate = (a: Company, b: Company): string | null => {
  // Exact Google Place ID match
  if (a.google_place_id && a.google_place_id === b.google_place_id) {
    return "google_place_id";
  }

  // Same domain
  if (a.website && b.website) {
    const domainA = extractDomain(a.website);
    const domainB = extractDomain(b.website);
    if (domainA && domainB && domainA === domainB) {
      return "website_domain";
    }
  }

  // Same phone (after normalization)
  if (a.phone && b.phone) {
    const phoneA = a.phone.replace(/\D/g, "");
    const phoneB = b.phone.replace(/\D/g, "");
    if (phoneA.length >= 8 && phoneA === phoneB) {
      return "phone";
    }
  }

  // Very similar names (>90% similarity)
  const nameA = normalizeCompanyName(a.name);
  const nameB = normalizeCompanyName(b.name);
  const similarity = stringSimilarity(nameA, nameB);

  if (similarity > 0.9) {
    return `name_similarity_${Math.round(similarity * 100)}%`;
  }

  return null;
};

// Merge duplicate companies
export const mergeDuplicates = (
  db: Database,
  options: { dryRun?: boolean } = {}
): { mergedCount: number; groups: DuplicateGroup[] } => {
  const { dryRun = false } = options;
  const groups = findDuplicateCompanies(db);

  if (dryRun) {
    return { mergedCount: 0, groups };
  }

  let mergedCount = 0;

  for (const group of groups) {
    const primary = group.primary;
    const updates: Partial<Company> = {};

    // Merge data from duplicates into primary
    for (const dup of group.duplicates) {
      // Fill in missing fields from duplicate
      if (!primary.phone && dup.phone) updates.phone = dup.phone;
      if (!primary.email && dup.email) updates.email = dup.email;
      if (!primary.website && dup.website) updates.website = dup.website;
      if (!primary.address && dup.address) updates.address = dup.address;
      if (!primary.creci_number && dup.creci_number) {
        updates.creci_number = dup.creci_number;
      }
      if (!primary.social_instagram && dup.social_instagram) {
        updates.social_instagram = dup.social_instagram;
      }
      if (!primary.social_facebook && dup.social_facebook) {
        updates.social_facebook = dup.social_facebook;
      }
      if (!primary.social_linkedin && dup.social_linkedin) {
        updates.social_linkedin = dup.social_linkedin;
      }

      // Keep higher rating
      if (dup.rating && (!primary.rating || dup.rating > primary.rating)) {
        updates.rating = dup.rating;
        updates.review_count = dup.review_count;
      }

      // Move decision makers to primary
      const dms = findDecisionMakersByCompany(db, dup.id!);
      for (const dm of dms) {
        // Update company_id to primary (would need UPDATE query)
        // For now, we just log this
        log.debug(
          { dm: dm.name, from: dup.name, to: primary.name },
          "would move decision maker"
        );
      }

      // Mark duplicate as merged (we'd delete in production, but safer to keep)
      // db.prepare(`DELETE FROM companies WHERE id = ?`).run(dup.id);
      mergedCount++;
    }

    // Update primary with merged data
    if (Object.keys(updates).length > 0) {
      updateCompany(db, primary.id!, updates);
      log.info(
        { primary: primary.name, merged: group.duplicates.length, updates },
        "merged duplicates"
      );
    }
  }

  return { mergedCount, groups };
};

// Find potential duplicate decision makers
export const findDuplicateDecisionMakers = (
  db: Database,
  companyId: string
): Array<{ primary: DecisionMaker; duplicates: DecisionMaker[] }> => {
  const dms = findDecisionMakersByCompany(db, companyId);
  const groups: Array<{ primary: DecisionMaker; duplicates: DecisionMaker[] }> =
    [];
  const processed = new Set<string>();

  for (let i = 0; i < dms.length; i++) {
    const dm = dms[i];
    if (processed.has(dm.id!)) continue;

    const duplicates: DecisionMaker[] = [];

    for (let j = i + 1; j < dms.length; j++) {
      const other = dms[j];
      if (processed.has(other.id!)) continue;

      // Same LinkedIn profile
      if (dm.linkedin_url && dm.linkedin_url === other.linkedin_url) {
        duplicates.push(other);
        processed.add(other.id!);
        continue;
      }

      // Same email
      if (dm.email && dm.email.toLowerCase() === other.email?.toLowerCase()) {
        duplicates.push(other);
        processed.add(other.id!);
        continue;
      }

      // Very similar names
      const similarity = stringSimilarity(dm.name, other.name);
      if (similarity > 0.85) {
        duplicates.push(other);
        processed.add(other.id!);
      }
    }

    if (duplicates.length > 0) {
      processed.add(dm.id!);
      groups.push({ primary: dm, duplicates });
    }
  }

  return groups;
};

