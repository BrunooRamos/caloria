import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isoWeekOf,
  isoWeekRange,
  isoWeeksInYear,
  previousIsoWeek,
  weeklySummaryParamsSchema,
} from "../src";

describe("summaries: semanas ISO", () => {
  it("semana de un día, incluidos los bordes de año", () => {
    assert.equal(isoWeekOf("2026-10-26"), "2026-W44");
    assert.equal(isoWeekOf("2026-10-25"), "2026-W43");
    // El 1 de enero de 2026 es jueves: ya es la semana 1.
    assert.equal(isoWeekOf("2026-01-01"), "2026-W01");
    assert.equal(isoWeekOf("2025-12-29"), "2026-W01");
    // 2026 tiene 53 semanas: del 28/12 al 3/1 de 2027 es la W53.
    assert.equal(isoWeekOf("2026-12-31"), "2026-W53");
    assert.equal(isoWeekOf("2027-01-03"), "2026-W53");
    assert.equal(isoWeekOf("2027-01-04"), "2027-W01");
    // El 1 de enero de 2021 es viernes: es de la última semana de 2020 (que tiene 53).
    assert.equal(isoWeekOf("2021-01-01"), "2020-W53");
  });

  it("la semana anterior al lunes del cron", () => {
    assert.equal(previousIsoWeek("2026-10-26"), "2026-W43");
    // Cambio de año: el lunes 2027-01-04 procesa la W53 de 2026.
    assert.equal(previousIsoWeek("2027-01-04"), "2026-W53");
    assert.equal(previousIsoWeek("2026-01-05"), "2026-W01");
    assert.equal(previousIsoWeek("2025-12-29"), "2025-W52");
  });

  it("semanas por año", () => {
    assert.equal(isoWeeksInYear(2026), 53);
    assert.equal(isoWeeksInYear(2025), 52);
    // Bisiesto que empieza en miércoles: termina en jueves.
    assert.equal(isoWeeksInYear(2020), 53);
    assert.equal(isoWeeksInYear(2032), 53);
  });

  it("from y to son el lunes y el domingo de la semana", () => {
    assert.deepEqual(isoWeekRange("2026-W43"), { from: "2026-10-19", to: "2026-10-25" });
    assert.deepEqual(isoWeekRange("2026-W01"), { from: "2025-12-29", to: "2026-01-04" });
    assert.deepEqual(isoWeekRange("2026-W53"), { from: "2026-12-28", to: "2027-01-03" });
    assert.deepEqual(isoWeekRange("2027-W01"), { from: "2027-01-04", to: "2027-01-10" });
    assert.throws(() => isoWeekRange("2025-W53"), /inválida/);
  });

  it("ida y vuelta: cada día de la semana cae en esa semana", () => {
    for (const week of ["2026-W01", "2026-W43", "2026-W53", "2020-W53"]) {
      const { from } = isoWeekRange(week);
      for (let i = 0; i < 7; i++) {
        const day = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000);
        assert.equal(isoWeekOf(day.toISOString().slice(0, 10)), week);
      }
    }
  });
});

describe("summaries: :week de GET /summaries/weekly/:week", () => {
  for (const week of ["2026-W01", "2026-W43", "2026-W53", "2020-W53"]) {
    it(`acepta ${week}`, () => {
      assert.deepEqual(weeklySummaryParamsSchema.parse({ week }), { week });
    });
  }

  for (const week of [
    "2026-W54",
    "2025-W53",
    "2026-W00",
    "2026-W1",
    "2026-w43",
    "2026W43",
    "26-W43",
    "2026-W43 ",
    "2026-10-26",
    "",
  ]) {
    it(`rechaza ${JSON.stringify(week)}`, () => {
      assert.equal(weeklySummaryParamsSchema.safeParse({ week }).success, false);
    });
  }

  it("rechaza campos de más", () => {
    const extra = { week: "2026-W43", userId: "x" };
    assert.equal(weeklySummaryParamsSchema.safeParse(extra).success, false);
  });
});
