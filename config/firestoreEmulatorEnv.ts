import { inject } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST = inject("firestoreEmulatorHost");
process.env.GOOGLE_CLOUD_PROJECT ??= "demo-bangsongteam-test";
process.env.METADATA_SERVER_DETECTION ??= "none";
