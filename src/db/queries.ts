import { Database } from "bun:sqlite";
import type {
  Company,
  DecisionMaker,
  Interaction,
  PipelineStatus,
  ExportLead,
} from "../schemas";

// Company queries
export const insertCompany = (
  db: Database,
  company: Omit<Company, "id" | "created_at" | "updated_at">
): string => {
  const stmt = db.prepare(`
    INSERT INTO companies (name, google_place_id, address, phone, email, website, rating, review_count, creci_number, creci_verified, social_instagram, social_facebook, social_linkedin, source)
    VALUES ($name, $google_place_id, $address, $phone, $email, $website, $rating, $review_count, $creci_number, $creci_verified, $social_instagram, $social_facebook, $social_linkedin, $source)
    RETURNING id
  `);

  const result = stmt.get({
    $name: company.name,
    $google_place_id: company.google_place_id ?? null,
    $address: company.address ?? null,
    $phone: company.phone ?? null,
    $email: company.email ?? null,
    $website: company.website ?? null,
    $rating: company.rating ?? null,
    $review_count: company.review_count ?? null,
    $creci_number: company.creci_number ?? null,
    $creci_verified: company.creci_verified ? 1 : 0,
    $social_instagram: company.social_instagram ?? null,
    $social_facebook: company.social_facebook ?? null,
    $social_linkedin: company.social_linkedin ?? null,
    $source: company.source,
  }) as { id: string };

  return result.id;
};

export const updateCompany = (
  db: Database,
  id: string,
  updates: Partial<Omit<Company, "id" | "created_at">>
): void => {
  const fields: string[] = [];
  const values: Record<string, unknown> = { $id: id };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = $${key}`);
      values[`$${key}`] =
        key === "creci_verified" ? (value ? 1 : 0) : value;
    }
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");

  const stmt = db.prepare(
    `UPDATE companies SET ${fields.join(", ")} WHERE id = $id`
  );
  stmt.run(values);
};

export const findCompanyById = (
  db: Database,
  id: string
): Company | null => {
  const stmt = db.prepare(`SELECT * FROM companies WHERE id = ?`);
  const result = stmt.get(id) as Company | null;
  return result ? { ...result, creci_verified: !!result.creci_verified } : null;
};

export const findCompanyByGooglePlaceId = (
  db: Database,
  placeId: string
): Company | null => {
  const stmt = db.prepare(`SELECT * FROM companies WHERE google_place_id = ?`);
  const result = stmt.get(placeId) as Company | null;
  return result ? { ...result, creci_verified: !!result.creci_verified } : null;
};

export const findCompanyByName = (
  db: Database,
  name: string
): Company | null => {
  const stmt = db.prepare(`SELECT * FROM companies WHERE name = ?`);
  const result = stmt.get(name) as Company | null;
  return result ? { ...result, creci_verified: !!result.creci_verified } : null;
};

export const findCompanyByWebsite = (
  db: Database,
  website: string
): Company | null => {
  const stmt = db.prepare(`SELECT * FROM companies WHERE website = ?`);
  const result = stmt.get(website) as Company | null;
  return result ? { ...result, creci_verified: !!result.creci_verified } : null;
};

export const getAllCompanies = (db: Database): Company[] => {
  const stmt = db.prepare(`SELECT * FROM companies ORDER BY created_at DESC`);
  const results = stmt.all() as Company[];
  return results.map((r) => ({ ...r, creci_verified: !!r.creci_verified }));
};

export const getCompaniesWithoutWebsiteScrape = (db: Database): Company[] => {
  const stmt = db.prepare(`
    SELECT c.* FROM companies c
    LEFT JOIN scrape_cache sc ON sc.source = 'website' AND sc.lookup_key = c.website
    WHERE c.website IS NOT NULL AND (sc.id IS NULL OR sc.expires_at < datetime('now'))
    ORDER BY c.created_at
  `);
  return stmt.all() as Company[];
};

export const getCompaniesWithoutLinkedInScrape = (db: Database): Company[] => {
  const stmt = db.prepare(`
    SELECT c.* FROM companies c
    LEFT JOIN scrape_cache sc ON sc.source = 'linkedin' AND sc.lookup_key = c.name
    WHERE sc.id IS NULL OR sc.expires_at < datetime('now')
    ORDER BY c.created_at
  `);
  return stmt.all() as Company[];
};

// Decision maker queries
export const insertDecisionMaker = (
  db: Database,
  dm: Omit<DecisionMaker, "id" | "created_at" | "updated_at">
): string => {
  const stmt = db.prepare(`
    INSERT INTO decision_makers (company_id, name, title, email, phone, linkedin_url, source)
    VALUES ($company_id, $name, $title, $email, $phone, $linkedin_url, $source)
    RETURNING id
  `);

  const result = stmt.get({
    $company_id: dm.company_id,
    $name: dm.name,
    $title: dm.title ?? null,
    $email: dm.email ?? null,
    $phone: dm.phone ?? null,
    $linkedin_url: dm.linkedin_url ?? null,
    $source: dm.source,
  }) as { id: string };

  return result.id;
};

export const findDecisionMakerByLinkedIn = (
  db: Database,
  linkedinUrl: string
): DecisionMaker | null => {
  const stmt = db.prepare(
    `SELECT * FROM decision_makers WHERE linkedin_url = ?`
  );
  return stmt.get(linkedinUrl) as DecisionMaker | null;
};

export const findDecisionMakersByCompany = (
  db: Database,
  companyId: string
): DecisionMaker[] => {
  const stmt = db.prepare(
    `SELECT * FROM decision_makers WHERE company_id = ?`
  );
  return stmt.all(companyId) as DecisionMaker[];
};

// Pipeline status queries
export const upsertPipelineStatus = (
  db: Database,
  status: Omit<PipelineStatus, "id" | "updated_at">
): void => {
  const stmt = db.prepare(`
    INSERT INTO pipeline_status (company_id, status, last_contact, next_step, notes)
    VALUES ($company_id, $status, $last_contact, $next_step, $notes)
    ON CONFLICT (company_id) DO UPDATE SET
      status = excluded.status,
      last_contact = excluded.last_contact,
      next_step = excluded.next_step,
      notes = excluded.notes,
      updated_at = datetime('now')
  `);

  stmt.run({
    $company_id: status.company_id,
    $status: status.status,
    $last_contact: status.last_contact ?? null,
    $next_step: status.next_step ?? null,
    $notes: status.notes ?? null,
  });
};

export const getPipelineStatus = (
  db: Database,
  companyId: string
): PipelineStatus | null => {
  const stmt = db.prepare(
    `SELECT * FROM pipeline_status WHERE company_id = ?`
  );
  return stmt.get(companyId) as PipelineStatus | null;
};

// Interaction queries
export const insertInteraction = (
  db: Database,
  interaction: Omit<Interaction, "id" | "created_at">
): string => {
  const stmt = db.prepare(`
    INSERT INTO interactions (company_id, decision_maker_id, type, notes, outcome)
    VALUES ($company_id, $decision_maker_id, $type, $notes, $outcome)
    RETURNING id
  `);

  const result = stmt.get({
    $company_id: interaction.company_id,
    $decision_maker_id: interaction.decision_maker_id ?? null,
    $type: interaction.type,
    $notes: interaction.notes ?? null,
    $outcome: interaction.outcome ?? null,
  }) as { id: string };

  return result.id;
};

export const getInteractionsByCompany = (
  db: Database,
  companyId: string
): Interaction[] => {
  const stmt = db.prepare(
    `SELECT * FROM interactions WHERE company_id = ? ORDER BY created_at DESC`
  );
  return stmt.all(companyId) as Interaction[];
};

export const getAllInteractions = (db: Database): Interaction[] => {
  const stmt = db.prepare(`
    SELECT i.*, c.name as company_name, dm.name as decision_maker_name
    FROM interactions i
    JOIN companies c ON i.company_id = c.id
    LEFT JOIN decision_makers dm ON i.decision_maker_id = dm.id
    ORDER BY i.created_at DESC
  `);
  return stmt.all() as Interaction[];
};

// Export leads with full details
export const getExportLeads = (db: Database): ExportLead[] => {
  const stmt = db.prepare(`
    SELECT
      c.name as company_name,
      c.address,
      c.phone,
      c.email,
      c.website,
      c.rating,
      c.review_count as reviews,
      c.creci_number as creci,
      c.creci_verified,
      c.social_instagram as instagram,
      c.social_facebook as facebook,
      c.social_linkedin as linkedin,
      dm.name as decision_maker_name,
      dm.title as decision_maker_title,
      dm.email as decision_maker_email,
      dm.phone as decision_maker_phone,
      dm.linkedin_url as decision_maker_linkedin,
      COALESCE(ps.status, 'new') as status,
      ps.last_contact,
      ps.next_step,
      ps.notes
    FROM companies c
    LEFT JOIN decision_makers dm ON dm.company_id = c.id
    LEFT JOIN pipeline_status ps ON ps.company_id = c.id
    ORDER BY c.created_at DESC
  `);

  const results = stmt.all() as ExportLead[];
  return results.map((r) => ({
    ...r,
    creci_verified: !!r.creci_verified,
  }));
};

// Stats queries
export const getStats = (
  db: Database
): {
  total_companies: number;
  total_decision_makers: number;
  total_interactions: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
} => {
  const companies = db
    .prepare(`SELECT COUNT(*) as count FROM companies`)
    .get() as { count: number };
  const dms = db
    .prepare(`SELECT COUNT(*) as count FROM decision_makers`)
    .get() as { count: number };
  const interactions = db
    .prepare(`SELECT COUNT(*) as count FROM interactions`)
    .get() as { count: number };

  const byStatus = db
    .prepare(
      `
    SELECT COALESCE(ps.status, 'new') as status, COUNT(*) as count
    FROM companies c
    LEFT JOIN pipeline_status ps ON ps.company_id = c.id
    GROUP BY COALESCE(ps.status, 'new')
  `
    )
    .all() as { status: string; count: number }[];

  const bySource = db
    .prepare(
      `SELECT source, COUNT(*) as count FROM companies GROUP BY source`
    )
    .all() as { source: string; count: number }[];

  return {
    total_companies: companies.count,
    total_decision_makers: dms.count,
    total_interactions: interactions.count,
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    by_source: Object.fromEntries(bySource.map((r) => [r.source, r.count])),
  };
};

