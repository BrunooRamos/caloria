import { MAX_PHOTO_SIDE, targetSize } from "../resize";

describe("targetSize", () => {
  it.each([
    ["paisaje", { width: 4032, height: 3024 }, { width: 1600, height: 1200 }],
    ["retrato", { width: 3024, height: 4032 }, { width: 1200, height: 1600 }],
    ["cuadrada", { width: 3000, height: 3000 }, { width: 1600, height: 1600 }],
    ["apenas más grande", { width: 1601, height: 900 }, { width: 1600, height: 899 }],
    ["panorámica muy angosta", { width: 10000, height: 3 }, { width: 1600, height: 1 }],
  ])("%s: el lado mayor queda en 1600 y se mantiene la proporción", (_, size, expected) => {
    expect(targetSize(size)).toEqual(expected);
  });

  it("redondea el lado menor al pixel más cercano", () => {
    // 3000 × (1600 / 4000) = 1200; 2999 × 0.4 = 1199.6 → 1200
    expect(targetSize({ width: 4000, height: 2999 })).toEqual({ width: 1600, height: 1200 });
  });

  it.each([
    ["justo en el máximo", { width: MAX_PHOTO_SIDE, height: 1200 }],
    ["más chica", { width: 800, height: 600 }],
    ["retrato chico", { width: 1080, height: 1350 }],
  ])("%s: no se redimensiona (nunca se agranda)", (_, size) => {
    expect(targetSize(size)).toBeNull();
  });

  it("acepta otro máximo", () => {
    expect(targetSize({ width: 2000, height: 1000 }, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it.each([
    { width: 0, height: 100 },
    { width: 100, height: -1 },
    { width: Number.NaN, height: 100 },
  ])("rechaza un tamaño inválido (%o)", (size) => {
    expect(() => targetSize(size)).toThrow("Tamaño de imagen inválido");
  });
});
