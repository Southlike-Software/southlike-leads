import * as XLSX from "xlsx";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { createChildLogger } from "../utils/logger";
import {
  insertCompany,
  insertDecisionMaker,
  findCompanyByName,
  findCompanyByWebsite,
  findDecisionMakerByLinkedIn,
} from "../db/queries";
import { normalizePhone, normalizeUrl, normalizeLinkedInUrl } from "../utils/normalize";

const log = createChildLogger("excel-import");

// Column name mappings (lowercase)
const columnMappings: Record<string, string[]> = {
  company_name: ["empresa", "company", "nome", "name", "razão social", "razao social"],
  address: ["endereço", "endereco", "address", "local"],
  phone: ["telefone", "phone", "tel", "fone", "celular"],
  email: ["email", "e-mail", "correio"],
  website: ["website", "site", "url", "página", "pagina"],
  rating: ["avaliação", "avaliacao", "rating", "nota"],
  creci: ["creci", "creci_number", "registro"],
  instagram: ["instagram", "insta", "@instagram"],
  facebook: ["facebook", "fb"],
  linkedin: ["linkedin", "linkedin_company"],
  decision_maker_name: ["decisor", "decisor - nome", "contact", "contato", "responsável", "responsavel"],
  decision_maker_title: ["cargo", "title", "decisor - cargo", "função", "funcao"],
  decision_maker_email: ["decisor - email", "contact_email", "email_contato"],
  decision_maker_phone: ["decisor - telefone", "contact_phone", "telefone_contato"],
  decision_maker_linkedin: ["decisor - linkedin", "linkedin_contact"],
};

// Import row schema
const importRowSchema = z.object({
  company_name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  rating: z.number().min(0).max(5).optional(),
  creci: z.string().optional(),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  linkedin: z.string().optional(),
  decision_maker_name: z.string().optional(),
  decision_maker_title: z.string().optional(),
  decision_maker_email: z.string().email().optional().or(z.literal("")),
  decision_maker_phone: z.string().optional(),
  decision_maker_linkedin: z.string().url().optional().or(z.literal("")),
});

type ImportRow = z.infer<typeof importRowSchema>;

// Detect column mapping from headers
const detectColumnMapping = (
  headers: string[]
): Record<string, number> => {
  const mapping: Record<string, number> = {};

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]?.toLowerCase().trim() ?? "";

    for (const [field, aliases] of Object.entries(columnMappings)) {
      if (aliases.includes(header) && !(field in mapping)) {
        mapping[field] = i;
        break;
      }
    }
  }

  return mapping;
};

// Parse row using column mapping
const parseRow = (
  row: unknown[],
  colMap: Record<string, number>
): Partial<ImportRow> => {
  const getValue = (field: string): string | undefined => {
    const idx = colMap[field];
    if (idx === undefined) return undefined;
    const val = row[idx];
    if (val === null || val === undefined) return undefined;
    return String(val).trim() || undefined;
  };

  const getNumber = (field: string): number | undefined => {
    const val = getValue(field);
    if (!val) return undefined;
    const num = parseFloat(val);
    return isNaN(num) ? undefined : num;
  };

  return {
    company_name: getValue("company_name"),
    address: getValue("address"),
    phone: getValue("phone"),
    email: getValue("email"),
    website: getValue("website"),
    rating: getNumber("rating"),
    creci: getValue("creci"),
    instagram: getValue("instagram"),
    facebook: getValue("facebook"),
    linkedin: getValue("linkedin"),
    decision_maker_name: getValue("decision_maker_name"),
    decision_maker_title: getValue("decision_maker_title"),
    decision_maker_email: getValue("decision_maker_email"),
    decision_maker_phone: getValue("decision_maker_phone"),
    decision_maker_linkedin: getValue("decision_maker_linkedin"),
  };
};

// Detect CSV delimiter
const detectDelimiter = (content: string): string => {
  const firstLine = content.split("\n")[0] ?? "";
  const counts = {
    ",": (firstLine.match(/,/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };

  let maxDelim = ",";
  let maxCount = 0;
  for (const [delim, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxDelim = delim;
      maxCount = count;
    }
  }
  return maxDelim;
};

export type ImportResult = {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: Array<{ row: number; error: string }>;
};

export const importFromExcel = async (
  db: Database,
  filePath: string,
  options: { skipDuplicates?: boolean } = {}
): Promise<ImportResult> => {
  const { skipDuplicates = true } = options;

  log.info({ filePath }, "starting import");

  const result: ImportResult = {
    totalRows: 0,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
  };

  // Read file
  const file = Bun.file(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase();

  let workbook: XLSX.WorkBook;

  if (ext === "csv") {
    const content = await file.text();
    const delimiter = detectDelimiter(content);
    workbook = XLSX.read(content, { type: "string", FS: delimiter });
  } else {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array" });
  }

  // Get first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("no sheets found in file");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("could not read sheet");
  }

  // Convert to array of arrays
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  if (data.length < 2) {
    throw new Error("file must have headers and at least one data row");
  }

  // Detect column mapping from headers
  const headers = (data[0] as string[]).map((h) => String(h ?? ""));
  const colMap = detectColumnMapping(headers);

  if (!colMap.company_name) {
    throw new Error(
      "could not find company name column. expected one of: " +
        columnMappings.company_name.join(", ")
    );
  }

  log.info({ columns: Object.keys(colMap) }, "detected columns");

  // Process rows
  for (let i = 1; i < data.length; i++) {
    result.totalRows++;
    const row = data[i] as unknown[];

    try {
      const parsed = parseRow(row, colMap);

      // Validate required field
      if (!parsed.company_name) {
        result.skipped++;
        continue;
      }

      // Check for duplicates
      if (skipDuplicates) {
        const byName = findCompanyByName(db, parsed.company_name);
        if (byName) {
          result.duplicates++;
          continue;
        }

        if (parsed.website) {
          const normalizedUrl = normalizeUrl(parsed.website);
          if (normalizedUrl) {
            const byWebsite = findCompanyByWebsite(db, normalizedUrl);
            if (byWebsite) {
              result.duplicates++;
              continue;
            }
          }
        }
      }

      // Normalize data
      const phone = parsed.phone ? normalizePhone(parsed.phone) : undefined;
      const website = parsed.website ? normalizeUrl(parsed.website) : undefined;

      // Insert company
      const companyId = insertCompany(db, {
        name: parsed.company_name,
        address: parsed.address,
        phone: phone || undefined,
        email: parsed.email || undefined,
        website: website || undefined,
        rating: parsed.rating,
        creci_number: parsed.creci,
        creci_verified: false,
        social_instagram: parsed.instagram,
        social_facebook: parsed.facebook,
        social_linkedin: parsed.linkedin,
        source: "manual",
      });

      // Insert decision maker if present
      if (parsed.decision_maker_name) {
        const dmPhone = parsed.decision_maker_phone
          ? normalizePhone(parsed.decision_maker_phone)
          : undefined;
        const dmLinkedIn = parsed.decision_maker_linkedin
          ? normalizeLinkedInUrl(parsed.decision_maker_linkedin)
          : undefined;

        // Skip if decision maker with same LinkedIn already exists
        if (dmLinkedIn) {
          const existingDm = findDecisionMakerByLinkedIn(db, dmLinkedIn);
          if (existingDm) {
            log.debug({ linkedin: dmLinkedIn }, "skipping duplicate decision maker");
            result.imported++;
            continue;
          }
        }

        insertDecisionMaker(db, {
          company_id: companyId,
          name: parsed.decision_maker_name,
          title: parsed.decision_maker_title,
          email: parsed.decision_maker_email || undefined,
          phone: dmPhone || undefined,
          linkedin_url: dmLinkedIn || undefined,
          source: "manual",
        });
      }

      result.imported++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.errors.push({ row: i + 1, error });
      log.warn({ row: i + 1, error }, "row import failed");
    }
  }

  log.info(
    {
      imported: result.imported,
      skipped: result.skipped,
      duplicates: result.duplicates,
      errors: result.errors.length,
    },
    "import complete"
  );

  return result;
};
