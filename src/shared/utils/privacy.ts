import type { OwnerAttributes, FnrValue } from "../../config/types";
import {
  MAX_MASK_ASTERISKS,
  MIN_MASK_LENGTH,
  IDENTITY_KEY_PREFIXES,
  SPACE_CHAR_CODE,
  DEFAULT_MASK,
} from "../../config/constants";
import { sanitizeTextContent } from "./helpers";

const createMasker = (maskFn: (normalized: string) => string) => {
  return (value: string): string => {
    const normalized = sanitizeTextContent(value);
    if (normalized.length < MIN_MASK_LENGTH) return DEFAULT_MASK;
    return maskFn(normalized);
  };
};

const maskNameInternal = createMasker((normalized: string): string => {
  const parts: string[] = [];
  let start = 0;
  const len = normalized.length;

  for (let i = 0; i <= len; i += 1) {
    if (i === len || normalized.charCodeAt(i) === SPACE_CHAR_CODE) {
      if (i > start) {
        const part = normalized.substring(start, i);
        const asterisks = Math.min(MAX_MASK_ASTERISKS, part.length - 1);
        parts.push(part.charAt(0) + "*".repeat(asterisks));
      }
      start = i + 1;
    }
  }

  return parts.length > 0 ? parts.join(" ") : DEFAULT_MASK;
});

const maskAddressInternal = createMasker((normalized: string): string => {
  const asteriskCount = Math.min(5, normalized.length - 2);
  return normalized.substring(0, 2) + "*".repeat(asteriskCount);
});

export const ownerPrivacy = {
  maskName: maskNameInternal,
  maskAddress: maskAddressInternal,
};

export const maskName = ownerPrivacy.maskName;
export const maskAddress = ownerPrivacy.maskAddress;

const normalizeOwnerValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return sanitizeTextContent(String(value));
  if (typeof value === "string") return sanitizeTextContent(value);
  return "";
};

const tryOwnerListStrategy = (
  owner: Partial<OwnerAttributes>
): string | null => {
  const agarLista = normalizeOwnerValue(owner.AGARLISTA);
  return agarLista
    ? `${IDENTITY_KEY_PREFIXES.OWNER_LIST}:${agarLista.toLowerCase()}`
    : null;
};

const tryAttributeCompositeStrategy = (
  owner: Partial<OwnerAttributes>
): string | null => {
  const parts = [
    owner.NAMN &&
      `${IDENTITY_KEY_PREFIXES.NAME}:${normalizeOwnerValue(owner.NAMN)}`,
    owner.BOSTADR &&
      `${IDENTITY_KEY_PREFIXES.ADDRESS}:${normalizeOwnerValue(owner.BOSTADR)}`,
    owner.POSTNR &&
      `${IDENTITY_KEY_PREFIXES.POSTAL_CODE}:${normalizeOwnerValue(owner.POSTNR)}`,
    owner.POSTADR &&
      `${IDENTITY_KEY_PREFIXES.CITY}:${normalizeOwnerValue(owner.POSTADR)}`,
    owner.ORGNR &&
      `${IDENTITY_KEY_PREFIXES.ORG_NUMBER}:${normalizeOwnerValue(owner.ORGNR)}`,
    owner.ANDEL &&
      `${IDENTITY_KEY_PREFIXES.SHARE}:${normalizeOwnerValue(owner.ANDEL)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("|").toLowerCase() : null;
};

const tryIdentifierFallbackStrategy = (
  owner: Partial<OwnerAttributes>,
  context: { fnr?: string | number; propertyId?: string }
): string | null => {
  const fallback = [
    context.propertyId &&
      `${IDENTITY_KEY_PREFIXES.PROPERTY}:${normalizeOwnerValue(context.propertyId)}`,
    context.fnr !== undefined &&
      context.fnr !== null &&
      `${IDENTITY_KEY_PREFIXES.FNR}:${String(context.fnr)}`,
    owner.OBJECTID !== undefined &&
      owner.OBJECTID !== null &&
      `${IDENTITY_KEY_PREFIXES.OBJECT_ID}:${String(owner.OBJECTID)}`,
    owner.UUID_FASTIGHET &&
      `${IDENTITY_KEY_PREFIXES.UUID}:${normalizeOwnerValue(owner.UUID_FASTIGHET)}`,
  ].filter(Boolean);
  return fallback.length > 0 ? fallback.join("|").toLowerCase() : null;
};

const getIndexStrategy = (sequence?: number): string => {
  return `${IDENTITY_KEY_PREFIXES.INDEX}:${sequence ?? 0}`;
};

const buildOwnerIdentityKey = (
  owner: Partial<OwnerAttributes>,
  context: { fnr?: string | number; propertyId?: string },
  sequence?: number
): string => {
  return (
    tryOwnerListStrategy(owner) ??
    tryAttributeCompositeStrategy(owner) ??
    tryIdentifierFallbackStrategy(owner, context) ??
    getIndexStrategy(sequence)
  );
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

const formatPostalCity = (postalCode: string, city: string): string => {
  if (!postalCode && !city) return "";
  if (postalCode && city) return `${postalCode} ${city}`;
  return postalCode || city;
};

const formatOwnerList = (agarLista: string, maskPII: boolean): string => {
  const sanitized = sanitizeTextContent(String(agarLista));
  const uniqueEntries = deduplicateEntries(sanitized.split(";"));

  if (!maskPII) return uniqueEntries.join("; ");

  const masked: string[] = [];
  for (let i = 0; i < uniqueEntries.length; i += 1) {
    const entry = uniqueEntries[i];
    if (entry) masked.push(maskOwnerListEntry(entry));
  }
  return masked.join("; ");
};

const formatIndividualOwner = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  const rawName = sanitizeTextContent(owner.NAMN || "") || unknownOwnerText;
  const namePart =
    maskPII && rawName !== unknownOwnerText
      ? ownerPrivacy.maskName(rawName)
      : rawName;

  const rawAddress = sanitizeTextContent(owner.BOSTADR || "");
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress;

  const postalCode = sanitizeTextContent(owner.POSTNR || "").replace(
    /\s+/g,
    ""
  );
  const city = sanitizeTextContent(owner.POSTADR || "");
  const orgNr = sanitizeTextContent(owner.ORGNR || "");

  let result = namePart;
  if (addressPart) result += result ? ", " + addressPart : addressPart;

  const postalCity = formatPostalCity(postalCode, city);
  if (postalCity) result += result ? ", " + postalCity : postalCity;

  if (orgNr) result += " (" + orgNr + ")";

  return result || unknownOwnerText;
};

export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  if (owner.AGARLISTA && typeof owner.AGARLISTA === "string") {
    return formatOwnerList(owner.AGARLISTA, maskPII);
  }
  return formatIndividualOwner(owner, maskPII, unknownOwnerText);
};

export const formatAddressOnly = (
  owner: OwnerAttributes,
  maskPII: boolean
): string => {
  const rawAddress = sanitizeTextContent(owner.BOSTADR || "");
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress;

  const postalCode = sanitizeTextContent(owner.POSTNR || "").replace(
    /\s+/g,
    ""
  );
  const city = sanitizeTextContent(owner.POSTADR || "");

  let result = addressPart;
  const postalCity = formatPostalCity(postalCode, city);
  if (postalCity) result += result ? ", " + postalCity : postalCity;

  return result;
};

export const deduplicateOwnerEntries = (
  owners: OwnerAttributes[],
  context: { fnr: FnrValue; propertyId: string }
): OwnerAttributes[] => {
  if (!owners || owners.length === 0) return [];
  if (owners.length === 1) return [owners[0]];

  const seen = new Set<string>();
  const unique: OwnerAttributes[] = [];

  for (let i = 0; i < owners.length; i += 1) {
    const owner = owners[i];
    if (!owner || typeof owner !== "object") continue;

    try {
      const key = ownerIdentity.buildKey(owner, context, i);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(owner);
      }
    } catch (_error) {
      unique.push(owner);
    }
  }

  return unique;
};
