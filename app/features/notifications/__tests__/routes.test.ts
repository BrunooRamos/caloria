import { notificationRoute } from "../routes";

describe("notificationRoute", () => {
  it("el análisis listo abre esa comida", () => {
    expect(notificationRoute({ type: "analysisReady", mealId: "m1" })).toEqual({
      pathname: "/meals/[id]",
      params: { id: "m1" },
    });
  });

  it("el Wrapped abre su semana, o la última si la semana no es válida", () => {
    expect(notificationRoute({ type: "wrappedReady", week: "2026-W44" })).toEqual({
      pathname: "/wrapped/[week]",
      params: { week: "2026-W44" },
    });
    expect(notificationRoute({ type: "wrappedReady", week: "2026-W99" })).toBe("/wrapped");
    expect(notificationRoute({ type: "wrappedReady" })).toBe("/wrapped");
  });

  it("la racha en riesgo abre el inicio", () => {
    expect(notificationRoute({ type: "streakRisk" })).toBe("/");
  });

  it("con un data desconocido o incompleto no navega", () => {
    for (const data of [
      null,
      undefined,
      "analysisReady",
      {},
      { type: "otro" },
      { type: "analysisReady" },
      { type: "analysisReady", mealId: "" },
      { type: "analysisReady", mealId: 42 },
    ]) {
      expect(notificationRoute(data)).toBeNull();
    }
  });
});
