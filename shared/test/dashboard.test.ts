import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dailyDashboardQuerySchema } from "../src";

describe("dashboard: query de GET /dashboard/daily", () => {
  it("date es opcional y, si viene, es un día real YYYY-MM-DD", () => {
    assert.deepEqual(dailyDashboardQuerySchema.parse({}), {});
    assert.deepEqual(dailyDashboardQuerySchema.parse({ date: "2026-10-26" }), {
      date: "2026-10-26",
    });
    assert.ok(dailyDashboardQuerySchema.safeParse({ date: "2028-02-29" }).success);
  });

  for (const date of [
    "",
    "hoy",
    "26-10-2026",
    "2026-1-5",
    "20261026",
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-10-26T00:00:00Z",
    ["2026-10-26", "2026-10-27"],
  ]) {
    it(`rechaza date ${JSON.stringify(date)}`, () => {
      assert.equal(dailyDashboardQuerySchema.safeParse({ date }).success, false);
    });
  }

  it("rechaza campos de más: el usuario sale del token, no de la query", () => {
    const parsed = dailyDashboardQuerySchema.safeParse({ userId: "66f1a0000000000000000001" });
    assert.equal(parsed.success, false);
  });
});
