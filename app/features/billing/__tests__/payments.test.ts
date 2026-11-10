import { checkoutResult } from "../payments";

// Sin red: solo se prueba cómo se lee la URL de vuelta.
jest.mock("@/services/api", () => ({ api: {} }));

describe("checkoutResult", () => {
  it.each([
    ["caloria://billing/return?result=success", "success"],
    ["caloria://billing/return?result=cancel", "cancel"],
    ["exp://192.168.0.10:8081/--/billing/return?session=cs_1&result=success", "success"],
    ["caloria://billing/return", null],
    ["caloria://billing/return?result=otra", null],
    ["caloria://billing/return?noresult=success", null],
  ])("%s → %s", (url, expected) => {
    expect(checkoutResult(url)).toBe(expected);
  });
});
