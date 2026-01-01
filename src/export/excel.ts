import * as XLSX from "xlsx";
import { Database } from "bun:sqlite";
import { createChildLogger } from "../utils/logger";
import { getExportLeads, getAllInteractions, getStats } from "../db/queries";
import type { ExportLead, Interaction } from "../schemas";

const log = createChildLogger("excel-export");

type InteractionWithNames = Interaction & {
  company_name?: string;
  decision_maker_name?: string;
};

const formatLeadsSheet = (leads: ExportLead[]): unknown[][] => {
  const headers = [
    "Empresa",
    "Endereço",
    "Telefone",
    "Email",
    "Website",
    "Avaliação",
    "Nº Avaliações",
    "CRECI",
    "CRECI Verificado",
    "Instagram",
    "Facebook",
    "LinkedIn",
    "Decisor - Nome",
    "Decisor - Cargo",
    "Decisor - Email",
    "Decisor - Telefone",
    "Decisor - LinkedIn",
    "Status",
    "Último Contato",
    "Próximo Passo",
    "Notas",
  ];

  const rows = leads.map((lead) => [
    lead.company_name,
    lead.address || "",
    lead.phone || "",
    lead.email || "",
    lead.website || "",
    lead.rating || "",
    lead.reviews || "",
    lead.creci || "",
    lead.creci_verified ? "Sim" : "Não",
    lead.instagram || "",
    lead.facebook || "",
    lead.linkedin || "",
    lead.decision_maker_name || "",
    lead.decision_maker_title || "",
    lead.decision_maker_email || "",
    lead.decision_maker_phone || "",
    lead.decision_maker_linkedin || "",
    translateStatus(lead.status),
    lead.last_contact || "",
    lead.next_step || "",
    lead.notes || "",
  ]);

  return [headers, ...rows];
};

const formatInteractionsSheet = (
  interactions: InteractionWithNames[]
): unknown[][] => {
  const headers = [
    "Data",
    "Empresa",
    "Decisor",
    "Tipo",
    "Notas",
    "Resultado",
  ];

  const rows = interactions.map((i) => [
    i.created_at || "",
    i.company_name || "",
    i.decision_maker_name || "",
    translateInteractionType(i.type),
    i.notes || "",
    i.outcome || "",
  ]);

  return [headers, ...rows];
};

const formatDashboardSheet = (
  stats: ReturnType<typeof getStats>
): unknown[][] => {
  const rows: unknown[][] = [
    ["Dashboard - Resumo de Leads"],
    [],
    ["Métricas Gerais"],
    ["Total de Empresas", stats.total_companies],
    ["Total de Decisores", stats.total_decision_makers],
    ["Total de Interações", stats.total_interactions],
    [],
    ["Por Status"],
    ...Object.entries(stats.by_status).map(([status, count]) => [
      translateStatus(status),
      count,
    ]),
    [],
    ["Por Fonte"],
    ...Object.entries(stats.by_source).map(([source, count]) => [
      translateSource(source),
      count,
    ]),
    [],
    ["Gerado em", new Date().toLocaleString("pt-BR")],
  ];

  return rows;
};

const translateStatus = (status: string): string => {
  const translations: Record<string, string> = {
    new: "Novo",
    contacted: "Contatado",
    qualified: "Qualificado",
    proposal: "Proposta",
    negotiation: "Negociação",
    won: "Ganho",
    lost: "Perdido",
  };
  return translations[status] || status;
};

const translateInteractionType = (type: string): string => {
  const translations: Record<string, string> = {
    email: "Email",
    phone: "Telefone",
    linkedin: "LinkedIn",
    meeting: "Reunião",
    note: "Nota",
  };
  return translations[type] || type;
};

const translateSource = (source: string): string => {
  const translations: Record<string, string> = {
    google_maps: "Google Maps",
    website: "Website",
    linkedin: "LinkedIn",
    manual: "Manual",
  };
  return translations[source] || source;
};

export const exportToExcel = async (
  db: Database,
  outputPath: string
): Promise<{ leadCount: number; interactionCount: number }> => {
  log.info({ outputPath }, "starting Excel export");

  const leads = getExportLeads(db);
  const interactions = getAllInteractions(db) as InteractionWithNames[];
  const stats = getStats(db);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Tab 1: Leads
  const leadsData = formatLeadsSheet(leads);
  const leadsSheet = XLSX.utils.aoa_to_sheet(leadsData);

  // Set column widths
  leadsSheet["!cols"] = [
    { wch: 30 }, // Empresa
    { wch: 40 }, // Endereço
    { wch: 15 }, // Telefone
    { wch: 30 }, // Email
    { wch: 30 }, // Website
    { wch: 10 }, // Avaliação
    { wch: 12 }, // Nº Avaliações
    { wch: 12 }, // CRECI
    { wch: 15 }, // CRECI Verificado
    { wch: 25 }, // Instagram
    { wch: 25 }, // Facebook
    { wch: 25 }, // LinkedIn
    { wch: 25 }, // Decisor Nome
    { wch: 20 }, // Decisor Cargo
    { wch: 25 }, // Decisor Email
    { wch: 15 }, // Decisor Telefone
    { wch: 30 }, // Decisor LinkedIn
    { wch: 12 }, // Status
    { wch: 18 }, // Último Contato
    { wch: 25 }, // Próximo Passo
    { wch: 40 }, // Notas
  ];

  XLSX.utils.book_append_sheet(workbook, leadsSheet, "Leads");

  // Tab 2: Interactions
  const interactionsData = formatInteractionsSheet(interactions);
  const interactionsSheet = XLSX.utils.aoa_to_sheet(interactionsData);
  interactionsSheet["!cols"] = [
    { wch: 18 }, // Data
    { wch: 30 }, // Empresa
    { wch: 25 }, // Decisor
    { wch: 12 }, // Tipo
    { wch: 50 }, // Notas
    { wch: 30 }, // Resultado
  ];
  XLSX.utils.book_append_sheet(workbook, interactionsSheet, "Interações");

  // Tab 3: Dashboard
  const dashboardData = formatDashboardSheet(stats);
  const dashboardSheet = XLSX.utils.aoa_to_sheet(dashboardData);
  dashboardSheet["!cols"] = [{ wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, dashboardSheet, "Dashboard");

  // Write file
  XLSX.writeFile(workbook, outputPath);

  log.info(
    {
      outputPath,
      leadCount: leads.length,
      interactionCount: interactions.length,
    },
    "Excel export complete"
  );

  return {
    leadCount: leads.length,
    interactionCount: interactions.length,
  };
};

