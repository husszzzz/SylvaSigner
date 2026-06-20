import plist, { type PlistObject, type PlistValue } from "plist";

export type ProvisioningCompatibility = {
  bundleId: string;
  removeExtensions: boolean;
  notices: string[];
};

async function decodeProvisioningPlist(profile: Blob) {
  const text = new TextDecoder().decode(await profile.arrayBuffer());
  const start = text.indexOf("<?xml");
  const closingTag = "</plist>";
  const end = text.indexOf(closingTag, start);
  if (start < 0 || end < 0) throw new Error("The provisioning profile does not contain a readable plist.");

  try {
    const result = plist.parse(text.slice(start, end + closingTag.length));
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Invalid root value");
    }
    return result as PlistObject;
  } catch {
    throw new Error("The provisioning profile plist is malformed.");
  }
}

function firstString(value: PlistValue | undefined) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function bundlePattern(applicationIdentifier: string, prefixes: string[]) {
  for (const prefix of prefixes.filter(Boolean)) {
    if (applicationIdentifier.startsWith(`${prefix}.`)) {
      return applicationIdentifier.slice(prefix.length + 1);
    }
  }
  const separator = applicationIdentifier.indexOf(".");
  return separator >= 0 ? applicationIdentifier.slice(separator + 1) : applicationIdentifier;
}

function patternMatches(pattern: string, bundleId: string) {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(bundleId);
}

export async function resolveProvisioningCompatibility(
  profiles: File[],
  requestedBundleId = "",
  requestedRemoveExtensions = false
): Promise<ProvisioningCompatibility> {
  if (!profiles.length) {
    return { bundleId: requestedBundleId.trim(), removeExtensions: requestedRemoveExtensions, notices: [] };
  }

  const profile = await decodeProvisioningPlist(profiles[0]);
  const entitlements = profile.Entitlements as PlistObject | undefined;
  const applicationIdentifier = firstString(entitlements?.["application-identifier"]);
  if (!applicationIdentifier) {
    throw new Error("The primary provisioning profile has no application-identifier entitlement.");
  }

  const expiration = profile.ExpirationDate;
  if (expiration instanceof Date && Number.isFinite(expiration.getTime()) && expiration <= new Date()) {
    throw new Error(`The primary provisioning profile expired on ${expiration.toLocaleDateString()}.`);
  }

  const pattern = bundlePattern(applicationIdentifier, [
    firstString(profile.TeamIdentifier),
    firstString(profile.ApplicationIdentifierPrefix)
  ]);
  const requested = requestedBundleId.trim();
  const fixedBundleId = pattern.includes("*") ? "" : pattern;

  if (requested && !patternMatches(pattern, requested)) {
    throw new Error(
      `The primary provisioning profile permits ${pattern}, but the requested bundle ID is ${requested}.`
    );
  }

  const notices: string[] = [];
  let bundleId = requested;
  let removeExtensions = requestedRemoveExtensions;
  if (fixedBundleId && !bundleId) {
    bundleId = fixedBundleId;
    notices.push(`Fixed App ID profile detected; using required bundle ID ${fixedBundleId}.`);
  }
  if (fixedBundleId && profiles.length === 1 && !removeExtensions) {
    removeExtensions = true;
    notices.push("One fixed App ID profile cannot provision nested app extensions; removing them for installation compatibility.");
  }

  return { bundleId, removeExtensions, notices };
}
