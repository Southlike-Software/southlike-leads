import { z } from "zod";

// Company schema
export const companySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  google_place_id: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  rating: z.number().min(0).max(5).optional(),
  review_count: z.number().int().min(0).optional(),
  creci_number: z.string().optional(),
  creci_verified: z.boolean().default(false),
  social_instagram: z.string().optional(),
  social_facebook: z.string().optional(),
  social_linkedin: z.string().optional(),
  source: z.enum(["google_maps", "website", "linkedin", "manual"]),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type Company = z.infer<typeof companySchema>;

// Decision maker schema
export const decisionMakerSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid(),
  name: z.string().min(1),
  title: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  source: z.enum(["website", "linkedin", "manual"]),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type DecisionMaker = z.infer<typeof decisionMakerSchema>;

// Interaction schema
export const interactionSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid(),
  decision_maker_id: z.string().uuid().optional(),
  type: z.enum(["email", "phone", "linkedin", "meeting", "note"]),
  notes: z.string().optional(),
  outcome: z.string().optional(),
  created_at: z.string().datetime().optional(),
});

export type Interaction = z.infer<typeof interactionSchema>;

// Pipeline status schema
export const pipelineStatusSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid(),
  status: z.enum([
    "new",
    "contacted",
    "qualified",
    "proposal",
    "negotiation",
    "won",
    "lost",
  ]),
  last_contact: z.string().datetime().optional(),
  next_step: z.string().optional(),
  notes: z.string().optional(),
  updated_at: z.string().datetime().optional(),
});

export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;

// Cache entry schema
export const cacheEntrySchema = z.object({
  id: z.number().int().optional(),
  source: z.enum(["google_maps", "website", "linkedin", "creci"]),
  lookup_key: z.string(),
  data: z.string(), // JSON stringified
  expires_at: z.string().datetime(),
  created_at: z.string().datetime().optional(),
});

export type CacheEntry = z.infer<typeof cacheEntrySchema>;

// Scrape job schema
export const scrapeJobSchema = z.object({
  id: z.number().int().optional(),
  source: z.enum(["google_maps", "website", "linkedin", "creci"]),
  target: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  retry_count: z.number().int().default(0),
  checkpoint: z.string().optional(), // JSON stringified progress
  error: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type ScrapeJob = z.infer<typeof scrapeJobSchema>;

// Google Maps Place result schema
export const googlePlaceSchema = z.object({
  place_id: z.string(),
  name: z.string(),
  formatted_address: z.string().optional(),
  formatted_phone_number: z.string().optional(),
  website: z.string().optional(),
  rating: z.number().optional(),
  user_ratings_total: z.number().optional(),
});

export type GooglePlace = z.infer<typeof googlePlaceSchema>;

// AI-extracted contact info schema
export const extractedContactSchema = z.object({
  emails: z.array(z.string().email()).default([]),
  phones: z.array(z.string()).default([]),
  people: z
    .array(
      z.object({
        name: z.string(),
        title: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      })
    )
    .default([]),
  social: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      linkedin: z.string().optional(),
    })
    .default({}),
  creci: z.string().optional(),
});

export type ExtractedContact = z.infer<typeof extractedContactSchema>;

// LinkedIn profile schema
export const linkedInProfileSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  profile_url: z.string().url(),
  company_name: z.string().optional(),
});

export type LinkedInProfile = z.infer<typeof linkedInProfileSchema>;

// Export lead (for Excel)
export const exportLeadSchema = z.object({
  company_name: z.string(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  creci: z.string().optional(),
  creci_verified: z.boolean(),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  linkedin: z.string().optional(),
  decision_maker_name: z.string().optional(),
  decision_maker_title: z.string().optional(),
  decision_maker_email: z.string().optional(),
  decision_maker_phone: z.string().optional(),
  decision_maker_linkedin: z.string().optional(),
  status: z.string(),
  last_contact: z.string().optional(),
  next_step: z.string().optional(),
  notes: z.string().optional(),
});

export type ExportLead = z.infer<typeof exportLeadSchema>;

