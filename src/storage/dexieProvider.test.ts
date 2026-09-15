// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { db } from "./db";
import { DexieStorageProvider } from "./dexieProvider";
import { makeReviewState } from "../domain/srs";

// Issue #107: loadWeakWords() queried review.wrongTotal, which was not an
// indexed field — the query threw SchemaError inside the generation-prep
// pipeline and the 苦手語トレーニング spinner never ended. These tests run
// against a real (fake) IndexedDB so the schema itself is under test.

describe("Dexie schema (issue #107)", () => {
  const storage = new DexieStorageProvider();

  it("loadWeakWords returns rows with wrongTotal >= 2 without throwing", async () => {
    await db.review.put(makeReviewState("deckA", "weak-1", { wrongTotal: 2 }));
    await db.review.put(makeReviewState("deckA", "fine-1", { wrongTotal: 1 }));
    await db.review.put(makeReviewState("deckB", "weak-2", { wrongTotal: 3 }));
    const weak = await storage.loadWeakWords(50);
    expect(weak.map((w) => w.wordId).sort()).toEqual(["weak-1", "weak-2"]);
    await db.review.bulkDelete(["weak-1", "fine-1", "weak-2"]);
  });

  it("review keeps the compound [deckId+wordId] key (loadReview round-trip)", async () => {
    await storage.saveReview(
      makeReviewState("deckA", "persist-1", { level: 2, wrongTotal: 0 }),
    );
    const r = await storage.loadReview("deckA", "persist-1");
    expect(r?.level).toBe(2);
    await db.review.delete("persist-1");
  });

  it("survives a simulated reload (close + reopen the same DB name)", async () => {
    await storage.saveReview(
      makeReviewState("deckA", "durable-1", { level: 1, wrongTotal: 0 }),
    );
    db.close();
    await db.open(); // same name + schema — data must still be there
    const storage2 = new DexieStorageProvider();
    const r = await storage2.loadReview("deckA", "durable-1");
    expect(r?.level).toBe(1);
    await storage2.loadWeakWords(10); // must not throw after reopen either
    await db.review.delete("durable-1");
  });
});
