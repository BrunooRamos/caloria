import { loginSchema, registerSchema, validateForm } from "../validation";

describe.each([
  ["login", (email: string) => validateForm(loginSchema, { email, password: "secreto123" })],
  [
    "registro",
    (email: string) =>
      validateForm(registerSchema, {
        email,
        password: "secreto123",
        confirmPassword: "secreto123",
      }),
  ],
])("email en el %s", (_, validate) => {
  it("pide el email si está vacío o solo tiene espacios", () => {
    expect(validate("")).toEqual({ ok: false, errors: { email: "Ingresá tu email." } });
    expect(validate("   ")).toEqual({ ok: false, errors: { email: "Ingresá tu email." } });
  });

  it.each(["cami", "cami@", "@example.com", "cami@example", "cami @example.com"])(
    "rechaza %j por formato",
    (email) => {
      expect(validate(email)).toEqual({
        ok: false,
        errors: { email: "Revisá el email: no parece válido." },
      });
    },
  );

  it("como el servidor, saca espacios y pasa a minúsculas antes de validar", () => {
    expect(validate("  Cami@Example.COM ")).toMatchObject({
      ok: true,
      data: { email: "cami@example.com", password: "secreto123" },
    });
  });

  it("acepta hasta 254 caracteres", () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    const longest = `${local}@${domain}`;
    expect(longest).toHaveLength(254);

    expect(validate(longest).ok).toBe(true);
    expect(validate(`a${longest}`)).toEqual({
      ok: false,
      errors: { email: "Ese email es demasiado largo." },
    });
  });
});

describe("contraseña en el login", () => {
  const validate = (password: string) =>
    validateForm(loginSchema, { email: "cami@example.com", password });

  it("solo pide que no esté vacía, como el Front Service", () => {
    expect(validate("")).toEqual({ ok: false, errors: { password: "Ingresá tu contraseña." } });
    expect(validate("corta").ok).toBe(true);
  });

  it("no la recorta: los espacios son parte de la contraseña", () => {
    expect(validate(" secreto ")).toEqual({
      ok: true,
      data: { email: "cami@example.com", password: " secreto " },
    });
  });

  it("rechaza más de 72 bytes", () => {
    expect(validate("a".repeat(72)).ok).toBe(true);
    expect(validate("a".repeat(73))).toEqual({
      ok: false,
      errors: { password: "La contraseña es demasiado larga." },
    });
  });
});

describe("contraseña en el registro", () => {
  const validate = (password: string) =>
    validateForm(registerSchema, {
      email: "cami@example.com",
      password,
      confirmPassword: password,
    });

  it("pide una contraseña si está vacía (y que la repitan)", () => {
    expect(validate("")).toEqual({
      ok: false,
      errors: { password: "Elegí una contraseña.", confirmPassword: "Repetí la contraseña." },
    });
  });

  it("exige al menos 8 caracteres", () => {
    expect(validate("1234567")).toEqual({
      ok: false,
      errors: { password: "Usá al menos 8 caracteres." },
    });
    expect(validate("12345678").ok).toBe(true);
  });

  it("cuenta caracteres y no unidades UTF-16, como el servidor", () => {
    // 7 emojis son 14 unidades UTF-16 pero 7 caracteres.
    expect(validate("😀".repeat(7)).ok).toBe(false);
    expect(validate("😀".repeat(8)).ok).toBe(true);
  });

  it("el máximo es de 72 bytes, no de 72 caracteres", () => {
    // "ñ" ocupa 2 bytes en UTF-8: 36 entran justo y 37 se pasan.
    expect(validate("ñ".repeat(36)).ok).toBe(true);
    expect(validate("ñ".repeat(37))).toEqual({
      ok: false,
      errors: { password: "La contraseña es demasiado larga." },
    });
  });
});

describe("repetición de la contraseña en el registro", () => {
  const validate = (password: string, confirmPassword: string, email = "cami@example.com") =>
    validateForm(registerSchema, { email, password, confirmPassword });

  it("pide que la repitan", () => {
    expect(validate("secreto123", "")).toEqual({
      ok: false,
      errors: { confirmPassword: "Repetí la contraseña." },
    });
  });

  it("tienen que coincidir exactamente", () => {
    expect(validate("secreto123", "secreto124")).toEqual({
      ok: false,
      errors: { confirmPassword: "Las contraseñas no coinciden." },
    });
    expect(validate("secreto123", "Secreto123").ok).toBe(false);
    expect(validate("secreto123", "secreto123").ok).toBe(true);
  });

  it("si la primera está mal, solo marca la primera", () => {
    expect(validate("corta", "otra")).toEqual({
      ok: false,
      errors: { password: "Usá al menos 8 caracteres." },
    });
  });

  it("compara aunque el email tenga un error", () => {
    expect(validate("secreto123", "secreto124", "cami")).toEqual({
      ok: false,
      errors: {
        email: "Revisá el email: no parece válido.",
        confirmPassword: "Las contraseñas no coinciden.",
      },
    });
  });
});

it("devuelve un error por campo cuando fallan varios", () => {
  expect(
    validateForm(registerSchema, { email: "", password: "corta", confirmPassword: "" }),
  ).toEqual({
    ok: false,
    errors: {
      email: "Ingresá tu email.",
      password: "Usá al menos 8 caracteres.",
      confirmPassword: "Repetí la contraseña.",
    },
  });
});
