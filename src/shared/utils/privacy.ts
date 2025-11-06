import type { OwnerAttributes, FnrValue } from "../../config/types";
import {
  MAX_MASK_ASTERISKS,
  MIN_MASK_LENGTH,
  HTML_WHITESPACE_PATTERN,
} from "../../config/constants";

const sanitizeWhitespace = (value: string): string =>
  value.replace(HTML_WHITESPACE_PATTERN, " ").trim();

const sanitizeTextContent = (value: string): string => {
  if (!value) {
    return "";
  }

  const text = String(value);

  try {
    if (typeof DOMParser === "undefined") {
      return sanitizeWhitespace(text);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");
    const content = doc.body?.textContent ?? "";
    return sanitizeWhitespace(content);
  } catch (_error) {
    return sanitizeWhitespace(text);
  }
};

export const stripHtml = (value: string): string => sanitizeTextContent(value);

const stripHtmlInternal = (value: string): string => sanitizeTextContent(value);

const maskText = (text: string, minLength: number): string => {
  const normalized = stripHtmlInternal(text);
  if (normalized.length < minLength) return "***";
  return normalized;
};

const maskNameInternal = (name: string): string => {
  const normalized = maskText(name, MIN_MASK_LENGTH);
  if (normalized === "***") return normalized;

  return normalized
    .split(" ")
    .filter(Boolean)
    .map(
      (part) =>
        `${part.charAt(0)}${"*".repeat(Math.min(MAX_MASK_ASTERISKS, part.length - 1))}`
    )
    .join(" ");
};

const maskAddressInternal = (address: string): string => {
  const normalized = maskText(address, MIN_MASK_LENGTH);
  if (normalized === "***") return normalized;

  return `${normalized.substring(0, 2)}${"*".repeat(Math.min(5, normalized.length - 2))}`;
};

export const ownerPrivacy = {
  maskName: maskNameInternal,
  maskAddress: maskAddressInternal,
};

export const maskName = ownerPrivacy.maskName;
export const maskAddress = ownerPrivacy.maskAddress;

const normalizeOwnerValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return stripHtmlInternal(String(value));
  if (typeof value === "string") return stripHtmlInternal(value);
  return "";
};

const buildOwnerIdentityKey = (
  owner: Partial<OwnerAttributes> & { [key: string]: unknown },
  context: { fnr?: string | number; propertyId?: string },
  sequence?: number
): string => {
  const strategies = [
    () => {
      const agarLista = normalizeOwnerValue(owner.AGARLISTA);
      return agarLista ? `A:${agarLista.toLowerCase()}` : null;
    },
    () => {
      const parts = [
        owner.NAMN && `N:${normalizeOwnerValue(owner.NAMN)}`,
        owner.BOSTADR && `B:${normalizeOwnerValue(owner.BOSTADR)}`,
        owner.POSTNR && `P:${normalizeOwnerValue(owner.POSTNR)}`,
        owner.POSTADR && `C:${normalizeOwnerValue(owner.POSTADR)}`,
        owner.ORGNR && `O:${normalizeOwnerValue(owner.ORGNR)}`,
        owner.ANDEL && `S:${normalizeOwnerValue(owner.ANDEL)}`,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join("|").toLowerCase() : null;
    },
    () => {
      const fallback = [
        context.propertyId && `PR:${normalizeOwnerValue(context.propertyId)}`,
        context.fnr !== undefined &&
          context.fnr !== null &&
          `FN:${String(context.fnr)}`,
        owner.OBJECTID !== undefined &&
          owner.OBJECTID !== null &&
          `OB:${String(owner.OBJECTID)}`,
        owner.UUID_FASTIGHET &&
          `UU:${normalizeOwnerValue(owner.UUID_FASTIGHET)}`,
      ].filter(Boolean);
      return fallback.length > 0 ? fallback.join("|").toLowerCase() : null;
    },
    () => `IX:${sequence ?? 0}`,
  ];

  for (const strategy of strategies) {
    const key = strategy();
    if (key) return key;
  }

  return `IX:${sequence ?? 0}`;
};

export const ownerIdentity = {
  buildKey: buildOwnerIdentityKey,
  normalizeValue: normalizeOwnerValue,
};

const deduplicateEntries = (entries: string[]): string[] => {
  const seen = new Set<string>();
  return entries
    .map((e) => e.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
};

const maskOwnerListEntry = (entry: string): string => {
  const match = entry.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) return ownerPrivacy.maskName(entry);

  const [, name, orgNr] = match;
  return `${ownerPrivacy.maskName(name.trim())} (${orgNr.trim()})`;
};

const formatOwnerList = (agarLista: string, maskPII: boolean): string => {
  const sanitized = stripHtmlInternal(String(agarLista));
  const uniqueEntries = deduplicateEntries(sanitized.split(";"));

  if (!maskPII) return uniqueEntries.join("; ");

  return uniqueEntries
    .map((entry) => maskOwnerListEntry(entry))
    .filter(Boolean)
    .join("; ");
};

const ownerInfoCache = new WeakMap<OwnerAttributes, Map<string, string>>();

const getOwnerCacheKey = (maskPII: boolean, unknownOwnerText: string): string =>
  `${maskPII ? "1" : "0"}|${unknownOwnerText}`;

const getOwnerFormatCache = (owner: OwnerAttributes): Map<string, string> => {
  let cache = ownerInfoCache.get(owner);
  if (!cache) {
    cache = new Map();
    ownerInfoCache.set(owner, cache);
  }
  return cache;
};

const formatIndividualOwner = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  const rawName = stripHtmlInternal(owner.NAMN || "") || unknownOwnerText;
  const namePart =
    maskPII && rawName !== unknownOwnerText
      ? ownerPrivacy.maskName(rawName)
      : rawName;

  const rawAddress = stripHtmlInternal(owner.BOSTADR || "");
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress;

  const postalCode = stripHtmlInternal(owner.POSTNR || "").replace(/\s+/g, "");
  const city = stripHtmlInternal(owner.POSTADR || "");
  const orgNr = stripHtmlInternal(owner.ORGNR || "");

  const parts = [
    namePart,
    addressPart,
    postalCode && city ? `${postalCode} ${city}` : postalCode || city,
  ].filter(Boolean);

  const result = `${parts.join(", ")}${orgNr ? ` (${orgNr})` : ""}`.trim();
  return result || unknownOwnerText;
};

export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  const cacheKey = getOwnerCacheKey(maskPII, unknownOwnerText);
  const cache = getOwnerFormatCache(owner);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (owner.AGARLISTA && typeof owner.AGARLISTA === "string") {
    const formattedList = formatOwnerList(owner.AGARLISTA, maskPII);
    cache.set(cacheKey, formattedList);
    return formattedList;
  }
  const formattedOwner = formatIndividualOwner(
    owner,
    maskPII,
    unknownOwnerText
  );
  cache.set(cacheKey, formattedOwner);
  return formattedOwner;
};

export const formatAddressOnly = (
  owner: OwnerAttributes,
  maskPII: boolean
): string => {
  const rawAddress = stripHtmlInternal(owner.BOSTADR || "");
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress;

  const postalCode = stripHtmlInternal(owner.POSTNR || "").replace(/\s+/g, "");
  const city = stripHtmlInternal(owner.POSTADR || "");

  const parts: string[] = [];

  if (addressPart) parts.push(addressPart);

  const postalCity = [postalCode, city].filter(Boolean).join(" ");
  if (postalCity) parts.push(postalCity);

  return parts.join(", ");
};

export const deduplicateOwnerEntries = (
  owners: OwnerAttributes[],
  context: { fnr: FnrValue; propertyId: string }
): OwnerAttributes[] => {
  const seen = new Set<string>();
  const unique: OwnerAttributes[] = [];

  owners.forEach((owner, index) => {
    if (!owner || typeof owner !== "object") {
      return;
    }

    try {
      const key = ownerIdentity.buildKey(owner, context, index);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(owner);
    } catch (_error) {
      unique.push(owner);
    }
  });

  return unique;
};
