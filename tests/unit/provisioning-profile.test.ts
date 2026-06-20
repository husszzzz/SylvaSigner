import assert from "node:assert/strict";
import test from "node:test";

import { resolveProvisioningCompatibility } from "../../src/provisioning-profile.ts";

function profile(applicationIdentifier: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>ExpirationDate</key><date>2030-01-01T00:00:00Z</date>
<key>TeamIdentifier</key><array><string>TESTTEAM01</string></array>
<key>Entitlements</key><dict>
<key>application-identifier</key><string>${applicationIdentifier}</string>
</dict></dict></plist>`;
  return new File([xml], "test.mobileprovision", { type: "application/octet-stream" });
}

test("uses the required bundle ID and removes unsupported extensions for one fixed profile", async () => {
  const result = await resolveProvisioningCompatibility([
    profile("TESTTEAM01.com.example.fixed")
  ]);

  assert.equal(result.bundleId, "com.example.fixed");
  assert.equal(result.removeExtensions, true);
  assert.equal(result.notices.length, 2);
});

test("preserves the original bundle ID behavior for a wildcard profile", async () => {
  const result = await resolveProvisioningCompatibility([profile("TESTTEAM01.*")]);

  assert.equal(result.bundleId, "");
  assert.equal(result.removeExtensions, false);
  assert.deepEqual(result.notices, []);
});

test("rejects a requested bundle ID outside the profile pattern", async () => {
  await assert.rejects(
    resolveProvisioningCompatibility(
      [profile("TESTTEAM01.com.example.fixed")],
      "com.example.other"
    ),
    /permits com\.example\.fixed/
  );
});
