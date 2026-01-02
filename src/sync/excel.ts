import * as XLSX from "xlsx";
import { Database } from "bun:sqlite";
import { createChildLogger } from "../utils/logger";
import {
  findCompanyByName,
  updateCompany,
  upsertPipelineStatus,
  getExportLeads,
  insertCompany,
} from "../db/queries";
import type { ExportLead } from "../schemas";

const log = createChildLogger("excel-sync");

// Status translation (Portuguese -> English)
const statusTranslations: Record<string, string> = {
  novo: "new",
  new: "new",
  contatado: "contacted",
  contacted: "contacted",
  qualificado: "qualified",
  qualified: "qualified",
  proposta: "proposal",
  proposal: "proposal",
  "negociação": "negotiation",
  negociacao: "negotiation",
  negotiation: "negotiation",
  ganho: "won",
  won: "won",
  perdido: "lost",
  lost: "lost",
};

type SyncChange = {
  companyName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export type SyncResult = {
  totalRows: number;
  synced: number;
  unchanged: number;
  notFound: number;
  added: number;
  changes: SyncChange[];
};

// Fields that can be synced from Excel (CRM data only, not scrape data)
const syncableFields = ["status", "last_contact", "next_step", "notes"] as const;

export const syncFromExcel = async (
  db: Database,
  filePath: string,
  options: { dryRun?: boolean; addNew?: boolean } = {}
): Promise<SyncResult> => {
  const { dryRun = false, addNew = false } = options;

  log.info({ filePath, dryRun }, "starting sync");

  const result: SyncResult = {
    totalRows: 0,
    synced: 0,
    unchanged: 0,
    notFound: 0,
    added: 0,
    changes: [],
  };

  // Read file
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  // Get Leads sheet (first sheet or named "Leads")
  let sheetName = workbook.SheetNames.find(
    (n) => n.toLowerCase() === "leads"
  );
  if (!sheetName) {
    sheetName = workbook.SheetNames[0];
  }
  if (!sheetName) {
    throw new Error("no sheets found in file");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("could not read sheet");
  }

  // Convert to JSON with headers
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  // Get current DB state for comparison
  const dbLeads = getExportLeads(db);
  const dbLeadsByName = new Map<string, ExportLead>();
  for (const lead of dbLeads) {
    dbLeadsByName.set(lead.company_name.toLowerCase(), lead);
  }

  // Process rows
  for (const row of data) {
    result.totalRows++;

    // Find company name (try multiple column names)
    const companyName =
      row["Empresa"] || row["empresa"] || row["Company"] || row["company"];

    if (!companyName || typeof companyName !== "string") {
      continue;
    }

    // Find in DB
    const dbLead = dbLeadsByName.get(companyName.toLowerCase());
    let company = findCompanyByName(db, companyName);

    if (!dbLead || !company) {
      if (addNew) {
        // Add new company from Excel
        const phone = row["Telefone"] || row["telefone"] || row["Phone"];
        const email = row["Email"] || row["email"];
        const website = row["Website"] || row["website"];
        const address = row["Endereço"] || row["endereco"] || row["Address"];

        if (!dryRun) {
          const newId = insertCompany(db, {
            name: companyName,
            phone: phone ? String(phone) : undefined,
            email: email ? String(email) : undefined,
            website: website ? String(website) : undefined,
            address: address ? String(address) : undefined,
            source: "manual",
            creci_verified: false,
          });

          log.debug({ companyName, id: newId }, "added new company from Excel");
        }

        result.added++;
        result.changes.push({
          companyName,
          field: "new",
          oldValue: null,
          newValue: "added from Excel",
        });
        continue;
      } else {
        result.notFound++;
        log.debug({ companyName }, "company not found in DB");
        continue;
      }
    }

    if (!company.id) {
      result.notFound++;
      continue;
    }

    // Check for changes in syncable fields
    const changes: SyncChange[] = [];

    // Status field
    const excelStatus =
      row["Status"] || row["status"];
    if (excelStatus && typeof excelStatus === "string") {
      const normalizedStatus =
        statusTranslations[excelStatus.toLowerCase().trim()];
      if (normalizedStatus && normalizedStatus !== dbLead.status) {
        changes.push({
          companyName,
          field: "status",
          oldValue: dbLead.status,
          newValue: normalizedStatus,
        });
      }
    }

    // Last contact field
    const excelLastContact =
      row["Último Contato"] || row["ultimo_contato"] || row["Last Contact"];
    if (excelLastContact !== undefined) {
      const newVal = excelLastContact ? String(excelLastContact) : null;
      if (newVal !== dbLead.last_contact) {
        changes.push({
          companyName,
          field: "last_contact",
          oldValue: dbLead.last_contact ?? null,
          newValue: newVal,
        });
      }
    }

    // Next step field
    const excelNextStep =
      row["Próximo Passo"] || row["proximo_passo"] || row["Next Step"];
    if (excelNextStep !== undefined) {
      const newVal = excelNextStep ? String(excelNextStep) : null;
      if (newVal !== dbLead.next_step) {
        changes.push({
          companyName,
          field: "next_step",
          oldValue: dbLead.next_step ?? null,
          newValue: newVal,
        });
      }
    }

    // Notes field
    const excelNotes = row["Notas"] || row["notas"] || row["Notes"];
    if (excelNotes !== undefined) {
      const newVal = excelNotes ? String(excelNotes) : null;
      if (newVal !== dbLead.notes) {
        changes.push({
          companyName,
          field: "notes",
          oldValue: dbLead.notes ?? null,
          newValue: newVal,
        });
      }
    }

    if (changes.length === 0) {
      result.unchanged++;
      continue;
    }

    // Apply changes
    result.changes.push(...changes);

    if (!dryRun) {
      // Build pipeline status update
      const statusUpdate: {
        company_id: string;
        status: "new" | "contacted" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
        last_contact?: string;
        next_step?: string;
        notes?: string;
      } = {
        company_id: company.id,
        status: (dbLead.status as "new" | "contacted" | "qualified" | "proposal" | "negotiation" | "won" | "lost") || "new",
      };

      for (const change of changes) {
        if (change.field === "status" && change.newValue) {
          statusUpdate.status = change.newValue as typeof statusUpdate.status;
        } else if (change.field === "last_contact") {
          statusUpdate.last_contact = change.newValue ?? undefined;
        } else if (change.field === "next_step") {
          statusUpdate.next_step = change.newValue ?? undefined;
        } else if (change.field === "notes") {
          statusUpdate.notes = change.newValue ?? undefined;
        }
      }

      upsertPipelineStatus(db, statusUpdate);
      result.synced++;

      log.debug(
        { companyName, changes: changes.length },
        "synced changes"
      );
    } else {
      result.synced++;
    }
  }

  log.info(
    {
      synced: result.synced,
      unchanged: result.unchanged,
      notFound: result.notFound,
      added: result.added,
      totalChanges: result.changes.length,
      dryRun,
    },
    "sync complete"
  );

  return result;
};
