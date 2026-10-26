import { CONFIDENCE_THRESHOLDS, confidenceLevel } from "../confidence";

describe("confidenceLevel", () => {
  it.each([
    [1, "high"],
    [0.9, "high"],
    [CONFIDENCE_THRESHOLDS.high, "high"],
    [0.7499, "medium"],
    [0.6, "medium"],
    [CONFIDENCE_THRESHOLDS.medium, "medium"],
    [0.4999, "low"],
    [0.2, "low"],
    [0, "low"],
  ])("%d → %s", (confidence, level) => {
    expect(confidenceLevel(confidence)).toBe(level);
  });

  it("los umbrales son 0,75 y 0,5 (documentados en docs/requerimientos.md)", () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({ high: 0.75, medium: 0.5 });
  });
});
