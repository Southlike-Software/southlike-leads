import { Database } from "bun:sqlite";
import { createChildLogger } from "../utils/logger";
import { getCacheEntry, setCacheEntry } from "../db/cache";
import {
  insertCompany,
  findCompanyByGooglePlaceId,
  updateCompany,
} from "../db/queries";
import {
  waitForRateLimit,
  canMakeRequest,
  recordRequest,
} from "../services/rate-limiter";
import type { GooglePlace, Company } from "../schemas";

const log = createChildLogger("google-maps");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Search queries for Porto Alegre real estate
const SEARCH_QUERIES = [
  "imobiliária Porto Alegre",
  "corretor de imóveis Porto Alegre",
  "imobiliária zona sul Porto Alegre",
  "imobiliária centro Porto Alegre",
  "imobiliária zona norte Porto Alegre",
];

type PlacesTextSearchResponse = {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
  }>;
  nextPageToken?: string;
};

const searchPlaces = async (
  query: string,
  pageToken?: string
): Promise<{ places: GooglePlace[]; nextPageToken?: string }> => {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY not set");
  }

  const url = "https://places.googleapis.com/v1/places:searchText";

  const body: Record<string, unknown> = {
    textQuery: query,
    locationBias: {
      circle: {
        center: { latitude: -30.0346, longitude: -51.2177 }, // Porto Alegre
        radius: 50000, // 50km radius
      },
    },
    languageCode: "pt-BR",
    maxResultCount: 20,
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,nextPageToken",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error({ status: response.status, body: text }, "Places API error");
    throw new Error(`Places API error: ${response.status}`);
  }

  const data = (await response.json()) as PlacesTextSearchResponse;

  const places: GooglePlace[] = (data.places || []).map((p) => ({
    place_id: p.id,
    name: p.displayName?.text || "",
    formatted_address: p.formattedAddress,
    formatted_phone_number: p.nationalPhoneNumber || p.internationalPhoneNumber,
    website: p.websiteUri,
    rating: p.rating,
    user_ratings_total: p.userRatingCount,
  }));

  return { places, nextPageToken: data.nextPageToken };
};

export const scrapeGoogleMaps = async (
  db: Database,
  options: { limit?: number; forceRefresh?: boolean } = {}
): Promise<{ newCount: number; updatedCount: number; totalFetched: number }> => {
  const { limit = 100, forceRefresh = false } = options;

  if (!GOOGLE_MAPS_API_KEY) {
    log.error("GOOGLE_MAPS_API_KEY not set in environment");
    throw new Error("GOOGLE_MAPS_API_KEY required");
  }

  let newCount = 0;
  let updatedCount = 0;
  let totalFetched = 0;
  const seenPlaceIds = new Set<string>();

  for (const query of SEARCH_QUERIES) {
    if (totalFetched >= limit) break;

    log.info({ query }, "searching Google Maps");

    // Check cache first
    const cacheKey = `search:${query}`;
    if (!forceRefresh) {
      const cached = getCacheEntry<GooglePlace[]>(db, "google_maps", cacheKey);
      if (cached) {
        log.info({ query, count: cached.length }, "using cached results");
        for (const place of cached) {
          if (seenPlaceIds.has(place.place_id)) continue;
          seenPlaceIds.add(place.place_id);
          const result = await processPlace(db, place);
          if (result === "new") newCount++;
          else if (result === "updated") updatedCount++;
          totalFetched++;
          if (totalFetched >= limit) break;
        }
        continue;
      }
    }

    // Fetch from API
    if (!canMakeRequest("google_maps")) {
      log.warn("rate limit reached for google_maps");
      break;
    }

    try {
      await waitForRateLimit("google_maps");
      recordRequest("google_maps");

      let allPlaces: GooglePlace[] = [];
      let pageToken: string | undefined;

      do {
        const { places, nextPageToken } = await searchPlaces(query, pageToken);
        allPlaces = allPlaces.concat(places);
        pageToken = nextPageToken;

        if (pageToken) {
          await waitForRateLimit("google_maps");
          recordRequest("google_maps");
        }
      } while (pageToken && allPlaces.length < 60); // Max 3 pages

      // Cache results
      setCacheEntry(db, "google_maps", cacheKey, allPlaces);

      log.info({ query, count: allPlaces.length }, "fetched places");

      for (const place of allPlaces) {
        if (seenPlaceIds.has(place.place_id)) continue;
        seenPlaceIds.add(place.place_id);
        const result = await processPlace(db, place);
        if (result === "new") newCount++;
        else if (result === "updated") updatedCount++;
        totalFetched++;
        if (totalFetched >= limit) break;
      }
    } catch (error) {
      log.error({ query, error }, "failed to search places");
    }
  }

  log.info({ newCount, updatedCount, totalFetched }, "Google Maps scrape complete");
  return { newCount, updatedCount, totalFetched };
};

const processPlace = async (
  db: Database,
  place: GooglePlace
): Promise<"new" | "updated" | "skipped"> => {
  const existing = findCompanyByGooglePlaceId(db, place.place_id);

  if (existing) {
    // Update if we have new info
    const updates: Partial<Company> = {};
    if (place.rating && place.rating !== existing.rating) {
      updates.rating = place.rating;
    }
    if (
      place.user_ratings_total &&
      place.user_ratings_total !== existing.review_count
    ) {
      updates.review_count = place.user_ratings_total;
    }
    if (place.formatted_phone_number && !existing.phone) {
      updates.phone = place.formatted_phone_number;
    }
    if (place.website && !existing.website) {
      updates.website = place.website;
    }

    if (Object.keys(updates).length > 0) {
      updateCompany(db, existing.id!, updates);
      log.debug({ name: place.name, updates }, "updated company");
      return "updated";
    }
    return "skipped";
  }

  // Insert new company
  insertCompany(db, {
    name: place.name,
    google_place_id: place.place_id,
    address: place.formatted_address,
    phone: place.formatted_phone_number,
    website: place.website,
    rating: place.rating,
    review_count: place.user_ratings_total,
    source: "google_maps",
    creci_verified: false,
  });

  log.debug({ name: place.name }, "inserted new company");
  return "new";
};

