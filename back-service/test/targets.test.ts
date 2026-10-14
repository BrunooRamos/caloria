import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTargets, MIN_KCAL } from "../src/services/targets";

const today = new Date("2026-10-14T12:00:00Z");
const base = {
  sex: "female",
  birthDate: "2002-04-10", // 24 años
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
} as const;

describe("computeTargets (RF-02)", () => {
  it("mujer, moderada, mantener", () => {
    // basal = 600 + 1031.25 − 120 − 161 = 1350.25; × 1.55 = 2092.89
    assert.deepEqual(computeTargets(base, today), {
      kcal: 2093,
      proteinG: 108,
      fatG: 58,
      carbsG: 285,
    });
  });

  it("hombre suma +5 en vez de −161 y el objetivo ajusta las kcal", () => {
    const male = computeTargets({ ...base, sex: "male" }, today);
    assert.equal(male.kcal, Math.round((1350.25 + 166) * 1.55));
    const gain = computeTargets({ ...base, goal: "gain" }, today);
    assert.equal(gain.kcal, 2093 + 300);
  });

  it("nunca baja de 1200 kcal (RNF-10)", () => {
    const small = {
      ...base,
      weightKg: 40,
      heightCm: 145,
      activity: "sedentary",
      goal: "lose",
    } as const;
    assert.equal(computeTargets(small, today).kcal, MIN_KCAL);
  });
});
