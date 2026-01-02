import { z } from "zod";
import { initDatabase, closeDatabase } from "./db/schema";
import {
  insertDecisionMaker,
  updateCompany,
  getAllCompanies,
  findDecisionMakersByCompany,
  findCompanyById,
  findDecisionMakerByLinkedIn,
} from "./db/queries";
import { createChildLogger } from "./utils/logger";
import { normalizeLinkedInUrl } from "./utils/normalize";

const log = createChildLogger("server");

// Request schemas
const enrichDecisionMakerSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1),
  title: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().url(),
});

const enrichCompanySchema = z.object({
  companyId: z.string().uuid(),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  linkedin: z.string().optional(),
  creci: z.string().optional(),
});

// JSON response helper
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Error response helper
const error = (message: string, status = 400) =>
  json({ success: false, error: message }, status);

export const startServer = (port = 3000) => {
  const db = initDatabase();

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      log.debug({ method, path }, "request");

      // CORS for browser extension
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Health check with DB verification
      if (path === "/health" && method === "GET") {
        try {
          const result = db.prepare("SELECT 1").get();
          return json({ status: "ok", db: result ? "connected" : "error" });
        } catch {
          return json({ status: "error", db: "disconnected" }, 503);
        }
      }

      // Signal enrichment complete
      if (path === "/api/enrichment/complete" && method === "POST") {
        const pendingCount = getAllCompanies(db).filter((c) => {
          const dms = findDecisionMakersByCompany(db, c.id!);
          return dms.length === 0;
        }).length;

        log.info({ pendingCount }, "enrichment complete signal received");
        return json({
          success: true,
          message: "enrichment complete",
          remainingPending: pendingCount,
        });
      }

      // Get pending companies (no decision makers)
      if (path === "/api/companies/pending" && method === "GET") {
        const companies = getAllCompanies(db);
        const pending = companies.filter((c) => {
          const dms = findDecisionMakersByCompany(db, c.id!);
          return dms.length === 0;
        });

        return json({
          companies: pending.map((c) => ({
            id: c.id,
            name: c.name,
            website: c.website,
          })),
        });
      }

      // Get all companies
      if (path === "/api/companies" && method === "GET") {
        const companies = getAllCompanies(db);
        return json({ companies });
      }

      // Enrich decision maker
      if (path === "/api/enrich/decision-maker" && method === "POST") {
        return (async () => {
          try {
            const body = await req.json();
            const parsed = enrichDecisionMakerSchema.safeParse(body);

            if (!parsed.success) {
              return error(parsed.error.message);
            }

            const { companyId, name, title, email, phone, linkedinUrl } =
              parsed.data;

            // Check company exists
            const company = findCompanyById(db, companyId);
            if (!company) {
              return error(`company not found: ${companyId}`, 404);
            }

            // Normalize LinkedIn URL
            const normalizedLinkedIn = normalizeLinkedInUrl(linkedinUrl);

            // Check for duplicate decision maker
            const existing = findDecisionMakerByLinkedIn(db, normalizedLinkedIn);
            if (existing) {
              return json({
                success: true,
                id: existing.id,
                duplicate: true,
                message: "decision maker already exists",
              });
            }

            const id = insertDecisionMaker(db, {
              company_id: companyId,
              name,
              title,
              email,
              phone,
              linkedin_url: normalizedLinkedIn,
              source: "linkedin",
            });

            log.info({ id, name, companyId }, "decision maker added");
            return json({ success: true, id });
          } catch (e) {
            log.error(e, "failed to add decision maker");
            return error("failed to process request", 500);
          }
        })();
      }

      // Enrich company
      if (path === "/api/enrich/company" && method === "POST") {
        return (async () => {
          try {
            const body = await req.json();
            const parsed = enrichCompanySchema.safeParse(body);

            if (!parsed.success) {
              return error(parsed.error.message);
            }

            const { companyId, instagram, facebook, linkedin, creci } =
              parsed.data;

            // Check company exists
            const company = findCompanyById(db, companyId);
            if (!company) {
              return error(`company not found: ${companyId}`, 404);
            }

            const updates: Record<string, string> = {};
            if (instagram) updates.social_instagram = instagram;
            if (facebook) updates.social_facebook = facebook;
            if (linkedin) updates.social_linkedin = linkedin;
            if (creci) updates.creci_number = creci;

            if (Object.keys(updates).length > 0) {
              updateCompany(db, companyId, updates);
              log.info({ companyId, updates }, "company enriched");
            }

            return json({ success: true });
          } catch (e) {
            log.error(e, "failed to enrich company");
            return error("failed to process request", 500);
          }
        })();
      }

      return error("not found", 404);
    },
  });

  log.info({ port }, "server started");
  console.log(`API server running at http://localhost:${port}`);
  console.log("\nEndpoints:");
  console.log("  GET  /health                     - health check + DB status");
  console.log("  GET  /api/companies              - list all companies");
  console.log("  GET  /api/companies/pending      - companies without decision makers");
  console.log("  POST /api/enrich/decision-maker  - add decision maker");
  console.log("  POST /api/enrich/company         - enrich company socials");
  console.log("  POST /api/enrichment/complete    - signal enrichment done");

  // Graceful shutdown
  process.on("SIGINT", () => {
    log.info("shutting down");
    closeDatabase(db);
    server.stop();
    process.exit(0);
  });

  return server;
};
