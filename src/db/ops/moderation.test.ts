import { describe, it, expect, beforeEach } from "vitest";
import { runBulk, type Db } from "../client";
import {
  memberDocId,
  presentationMembersCol,
  presentationsCol,
} from "../collections";
import {
  getSharedDocumentByToken,
  joinByToken,
  resolvePresentationAccess,
  setLinkAccess,
} from "../queries/presentationSharing";
import { createTestDb, presentationDoc, seedDocs } from "../test/fixtures";
import { disableShareLink, findPresentationIdByLinkToken } from "./moderation";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const PRESENTATION = "p00000000000000000001";

describe("공유 링크 운영 작업", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      presentations: [presentationDoc({ id: PRESENTATION, userId: A })],
    });
  });

  it("kills a spread link, drops its members and keeps the old token dead after the owner shares again", async () => {
    const token = (await setLinkAccess(db, PRESENTATION, A, "view"))
      ?.token as string;
    await joinByToken(db, token, B);
    expect(await resolvePresentationAccess(db, PRESENTATION, B)).toBe("viewer");

    expect(await disableShareLink(db, PRESENTATION)).toBe(true);

    expect(await getSharedDocumentByToken(db, token)).toBeNull();
    expect(await resolvePresentationAccess(db, PRESENTATION, B)).toBeNull();
    expect(
      (await presentationsCol(db).doc(PRESENTATION).get()).data(),
    ).toMatchObject({ linkAccess: "off", linkToken: null });

    const again = await setLinkAccess(db, PRESENTATION, A, "view");
    expect(again?.token).not.toBe(token);
    expect(await getSharedDocumentByToken(db, token)).toBeNull();
  });

  it("drops more members than one write batch holds", async () => {
    const token = (await setLinkAccess(db, PRESENTATION, A, "view"))
      ?.token as string;
    const viewers = Array.from({ length: 501 }, (_, i) => `viewer-${i}`);
    await runBulk(db, (writer) =>
      viewers.map((userId) =>
        writer.set(
          presentationMembersCol(db).doc(memberDocId(PRESENTATION, userId)),
          { presentationId: PRESENTATION, userId },
        ),
      ),
    );
    await seedDocs(db, {
      members: [{ presentationId: PRESENTATION, userId: B }],
    });

    expect(await disableShareLink(db, PRESENTATION)).toBe(true);

    expect((await presentationMembersCol(db).get()).size).toBe(0);
    await setLinkAccess(db, PRESENTATION, A, "view");
    expect(await resolvePresentationAccess(db, PRESENTATION, B)).toBeNull();
    expect(await getSharedDocumentByToken(db, token)).toBeNull();
  });

  it("says no when the presentation does not exist", async () => {
    expect(await disableShareLink(db, "nope")).toBe(false);
  });

  it("treats an id that cannot be a document id as one that does not exist", async () => {
    for (const id of ["", "a/b", "a//b", ".", "..", "__id__"]) {
      expect(await disableShareLink(db, id)).toBe(false);
    }
  });

  it("finds the presentation behind a link token, even when the link is off", async () => {
    const token = (await setLinkAccess(db, PRESENTATION, A, "view"))
      ?.token as string;
    await setLinkAccess(db, PRESENTATION, A, "off");

    expect(await findPresentationIdByLinkToken(db, token)).toBe(PRESENTATION);
    expect(await findPresentationIdByLinkToken(db, "unknown")).toBeNull();
  });
});
