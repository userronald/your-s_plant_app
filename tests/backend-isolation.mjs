import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_TEST_URL",
  "SUPABASE_TEST_PUBLISHABLE_KEY",
  "SUPABASE_TEST_USER_A_EMAIL",
  "SUPABASE_TEST_USER_A_PASSWORD",
  "SUPABASE_TEST_USER_B_EMAIL",
  "SUPABASE_TEST_USER_B_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Authorization integration test requires: ${missing.join(", ")}`);
  process.exitCode = 2;
} else {
  const clientFor = () => createClient(
    process.env.SUPABASE_TEST_URL,
    process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const userA = clientFor();
  const userB = clientFor();
  let plantId;
  let discoveryId;
  let userAId;
  let photoPath;

  try {
    const signIns = await Promise.all([
      userA.auth.signInWithPassword({ email: process.env.SUPABASE_TEST_USER_A_EMAIL, password: process.env.SUPABASE_TEST_USER_A_PASSWORD }),
      userB.auth.signInWithPassword({ email: process.env.SUPABASE_TEST_USER_B_EMAIL, password: process.env.SUPABASE_TEST_USER_B_PASSWORD }),
    ]);
    for (const { error } of signIns) assert.ifError(error);

    const { data: identityA, error: identityAError } = await userA.auth.getUser();
    assert.ifError(identityAError);
    userAId = identityA.user.id;
    const { data: profileA, error: profileAError } = await userA.from("profiles").select("id").eq("id", userAId).single();
    assert.ifError(profileAError);
    assert.equal(profileA.id, userAId, "Account registration must provision a profile.");
    const { data: privateProfile, error: privateProfileError } = await userB.from("profiles").select("id").eq("id", userAId);
    assert.ifError(privateProfileError);
    assert.deepEqual(privateProfile, [], "User B must not read user A's profile.");

    const { data: ownerPlant, error: plantError } = await userA.from("plant_instances")
      .insert({ nickname: `RLS test ${crypto.randomUUID()}`, watering_interval_days: 7 })
      .select("id,owner_id").single();
    assert.ifError(plantError);
    assert.ok(ownerPlant?.id);
    plantId = ownerPlant.id;
    const { data: ownerDiscovery, error: discoveryError } = await userA.from("discoveries")
      .insert({ common_name: "Private RLS test discovery", scientific_name: "Testaceae testii", source: "manual" })
      .select("id,owner_id").single();
    assert.ifError(discoveryError);
    discoveryId = ownerDiscovery.id;

    const { data: ownPlant, error: ownPlantError } = await userA.from("plant_instances")
      .select("id").eq("id", ownerPlant.id).single();
    assert.ifError(ownPlantError);
    assert.equal(ownPlant.id, ownerPlant.id);
    const { data: foreignPlant, error: foreignReadError } = await userB.from("plant_instances")
      .select("id").eq("id", ownerPlant.id);
    assert.ifError(foreignReadError);
    assert.deepEqual(foreignPlant, [], "User B must not read user A's plant.");
    const { data: sessionB, error: sessionBError } = await userB.auth.getSession();
    assert.ifError(sessionBError);
    assert.ok(sessionB.session?.access_token, "User B must have a valid session for the assistant boundary test.");
    const assistantResponse = await fetch(`${process.env.SUPABASE_TEST_URL}/functions/v1/plant-assistant`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionB.session.access_token}`,
        apikey: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "send",
        context: { kind: "owned_plant", id: ownerPlant.id },
        message: "What should I check about this plant?",
      }),
    });
    const assistantBody = await assistantResponse.json();
    assert.equal(assistantResponse.status, 404, "The assistant must reject an owned-plant ID from another account.");
    assert.equal(assistantBody.code, "context_not_found", "The assistant must not disclose whether another account owns the supplied ID.");

    const { data: changedForeignPlant, error: foreignUpdateError } = await userB.from("plant_instances")
      .update({ nickname: "Unauthorized edit" }).eq("id", ownerPlant.id).select("id");
    assert.ifError(foreignUpdateError);
    assert.deepEqual(changedForeignPlant, [], "User B must not update user A's plant.");
    const { data: deletedForeignPlant, error: foreignDeleteError } = await userB.from("plant_instances")
      .delete().eq("id", ownerPlant.id).select("id");
    assert.ifError(foreignDeleteError);
    assert.deepEqual(deletedForeignPlant, [], "User B must not delete user A's plant.");

    const { error: foreignCareEventError } = await userB.from("care_events")
      .insert({ plant_id: ownerPlant.id, event_type: "observation", note: "cross-account write attempt" });
    assert.ok(foreignCareEventError, "User B must not attach a care event to user A's plant.");
    const { data: foreignDiscovery, error: foreignDiscoveryError } = await userB.from("discoveries")
      .select("id").eq("id", ownerDiscovery.id);
    assert.ifError(foreignDiscoveryError);
    assert.deepEqual(foreignDiscovery, [], "User B must not read user A's discovery.");

    photoPath = `${userAId}/authorization-test-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await userA.storage.from("plant-photos")
      .upload(photoPath, new Blob(["test photo bytes"], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    assert.ifError(uploadError);
    const { error: foreignPhotoError } = await userB.storage.from("plant-photos").download(photoPath);
    assert.ok(foreignPhotoError, "User B must not download user A's private photo.");

    const { data: ownerPlantAfter, error: ownerAfterError } = await userA.from("plant_instances")
      .select("nickname").eq("id", ownerPlant.id).single();
    assert.ifError(ownerAfterError);
    assert.notEqual(ownerPlantAfter.nickname, "Unauthorized edit");
    console.log("Authorization integration passed: two authenticated users are isolated for plants, discoveries, care events, photos, and assistant context.");
  } finally {
    if (photoPath) {
      const { error } = await userA.storage.from("plant-photos").remove([photoPath]);
      if (error) console.error("Could not clean test photo data.", error.message);
    }
    if (plantId) {
      const { error } = await userA.from("plant_instances").delete().eq("id", plantId);
      if (error) console.error("Could not clean test plant data.", error.message);
    }
    if (discoveryId) {
      const { error } = await userA.from("discoveries").delete().eq("id", discoveryId);
      if (error) console.error("Could not clean test discovery data.", error.message);
    }
    await Promise.all([userA.auth.signOut(), userB.auth.signOut()]);
  }
}
