import { apiBaseUrl } from "../api-url";

describe("apiBaseUrl", () => {
  it("sin URL no arranca", () => {
    expect(() => apiBaseUrl(undefined, true)).toThrow("Falta EXPO_PUBLIC_API_URL");
    expect(() => apiBaseUrl("", false)).toThrow("Falta EXPO_PUBLIC_API_URL");
  });

  it("en desarrollo acepta http, para el nginx local", () => {
    expect(apiBaseUrl("http://10.0.2.2:8080/api/v1", true)).toBe("http://10.0.2.2:8080/api/v1");
  });

  it("fuera de desarrollo exige https", () => {
    expect(apiBaseUrl("https://api.caloria.app/api/v1", false)).toBe(
      "https://api.caloria.app/api/v1",
    );
    expect(() => apiBaseUrl("http://api.caloria.app/api/v1", false)).toThrow(
      "tiene que ser https fuera de desarrollo",
    );
    expect(() => apiBaseUrl("api.caloria.app/api/v1", false)).toThrow(
      "tiene que ser https fuera de desarrollo",
    );
  });
});
