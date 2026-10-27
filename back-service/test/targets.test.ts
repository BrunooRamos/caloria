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

  it("hombre, sedentario, bajar", () => {
    const male = {
      ...base,
      sex: "male",
      birthDate: "1996-04-10", // 30 años
      heightCm: 180,
      weightKg: 80,
      activity: "sedentary",
      goal: "lose",
    } as const;
    // basal = 800 + 1125 − 150 + 5 = 1780; × 1.2 = 2136; − 500 = 1636
    // proteína 1.8 × 80 = 144 · grasas 1636 × 0.25 ÷ 9 = 45 · carbos (1636 − 576 − 405) ÷ 4 = 164
    assert.deepEqual(computeTargets(male, today), {
      kcal: 1636,
      proteinG: 144,
      fatG: 45,
      carbsG: 164,
    });
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
