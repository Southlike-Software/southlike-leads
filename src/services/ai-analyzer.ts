import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { createChildLogger } from "../utils/logger";
import type { ExtractedContact } from "../schemas";

const log = createChildLogger("ai-analyzer");

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const contactExtractionSchema = z.object({
  emails: z.array(z.string()).describe("Email addresses found on the page"),
  phones: z
    .array(z.string())
    .describe("Phone numbers found on the page (Brazilian format)"),
  people: z
    .array(
      z.object({
        name: z.string().describe("Full name of the person"),
        title: z
          .string()
          .optional()
          .describe("Job title (e.g., Diretor, Sócio, Proprietário, CEO)"),
        email: z.string().optional().describe("Direct email if available"),
        phone: z.string().optional().describe("Direct phone if available"),
      })
    )
    .describe("Decision makers and key personnel found"),
  social: z
    .object({
      instagram: z.string().optional().describe("Instagram profile URL"),
      facebook: z.string().optional().describe("Facebook page URL"),
      linkedin: z.string().optional().describe("LinkedIn company page URL"),
    })
    .describe("Social media links"),
  creci: z
    .string()
    .optional()
    .describe("CRECI registration number if found (e.g., CRECI 12345)"),
});

export const analyzeWebsiteContent = async (
  html: string,
  url: string
): Promise<ExtractedContact | null> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    log.error("ANTHROPIC_API_KEY not set");
    return null;
  }

  // Clean and truncate HTML to reduce tokens
  const cleanedHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15000); // Limit to ~15k chars

  try {
    log.debug({ url, htmlLength: cleanedHtml.length }, "analyzing website");

    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-5"),
      schema: contactExtractionSchema,
      prompt: `Analyze this real estate agency website content and extract contact information.
Focus on finding:
1. Email addresses (look for @ symbols and common patterns)
2. Brazilian phone numbers (patterns like (XX) XXXXX-XXXX or (XX) XXXX-XXXX)
3. Decision makers - owners, directors, partners, CEOs (look for "Sobre", "Equipe", "Nossa Equipe", "Quem Somos" sections)
4. Social media links (Instagram, Facebook, LinkedIn)
5. CRECI registration numbers (format: CRECI followed by numbers)

Website URL: ${url}

Content:
${cleanedHtml}

Extract all relevant contact information. For people, prioritize finding decision-makers (owners, directors, partners) rather than regular agents.`,
    });

    log.debug(
      { url, emails: object.emails.length, people: object.people.length },
      "extraction complete"
    );

    return {
      emails: object.emails || [],
      phones: object.phones || [],
      people: object.people || [],
      social: object.social || {},
      creci: object.creci,
    };
  } catch (error) {
    log.error({ url, error }, "AI analysis failed");
    return null;
  }
};

