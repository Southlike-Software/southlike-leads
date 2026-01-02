// Text normalization utilities

export const normalizePhone = (phone: string): string => {
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, "");

  // Handle Brazilian phone numbers
  if (cleaned.startsWith("+55")) {
    return cleaned;
  }

  // Add Brazil country code if missing
  if (cleaned.length >= 10 && cleaned.length <= 11) {
    return `+55${cleaned}`;
  }

  return cleaned;
};

export const normalizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};

export const normalizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url.toLowerCase().trim());
    // Remove trailing slash and www prefix
    let host = parsed.host.replace(/^www\./, "");
    let path = parsed.pathname.replace(/\/$/, "");
    return `${parsed.protocol}//${host}${path}`;
  } catch {
    return url.toLowerCase().trim();
  }
};

export const normalizeCompanyName = (name: string): string => {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(ltda|eireli|me|epp|s\.?a\.?)\b\.?$/gi, "")
    .trim();
};

export const extractDomain = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.host.replace(/^www\./, "");
  } catch {
    return null;
  }
};

export const normalizeLinkedInUrl = (url: string): string => {
  if (!url) return url;

  const trimmed = url.trim();

  // Handle short format like "/in/username" or "in/username"
  if (!trimmed.includes("://")) {
    const match = trimmed.match(/^\/?(?:in|company)\/([^/]+)/);
    if (match) {
      const type = trimmed.includes("company") ? "company" : "in";
      return `https://www.linkedin.com/${type}/${match[1]}`;
    }
  }

  try {
    const parsed = new URL(trimmed);
    // Standardize LinkedIn URLs
    const match = parsed.pathname.match(/\/(in|company)\/([^/]+)/);
    if (match) {
      return `https://www.linkedin.com/${match[1]}/${match[2].toLowerCase()}`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
};

// Calculate string similarity using Levenshtein distance
export const stringSimilarity = (str1: string, str2: string): number => {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = [];

  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2[i - 1] === s1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  const maxLen = Math.max(s1.length, s2.length);
  return 1 - matrix[s2.length][s1.length] / maxLen;
};

