import { validateForm } from "@/features/auth/validation";
import type { Profile } from "@/services/auth";
import {
  aboutYouSchema,
  ageOn,
  changedFields,
  measuresSchema,
  profileSchema,
  profileToValues,
  routineSchema,
} from "../validation";

const PROFILE: Profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
};

/** Fecha de nacimiento de alguien que hoy cumple `years`. */
function bornYearsAgo(years: number, today = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${today.getUTCFullYear() - years}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
}

const measures = (heightCm: string, weightKg: string) =>
  validateForm(measuresSchema, { heightCm, weightKg });

describe("altura y peso", () => {
  it("pide los dos si están vacíos", () => {
    expect(measures("", " ")).toEqual({
      ok: false,
      errors: { heightCm: "Ingresá tu altura.", weightKg: "Ingresá tu peso." },
    });
  });

  it("acepta decimales con coma o punto y devuelve números", () => {
    expect(measures("165", "60,5")).toEqual({ ok: true, data: { heightCm: 165, weightKg: 60.5 } });
    expect(measures(" 172.5 ", "80.25")).toEqual({
      ok: true,
      data: { heightCm: 172.5, weightKg: 80.25 },
    });
  });

  it.each(["1,65", "abc", "-60", "60kg", "1e2", "60,"])("rechaza %j como número", (value) => {
    const result = measures(value, value);
    expect(result.ok).toBe(false);
  });

  it("usa los mismos rangos que el Backend: altura 100–250 cm, peso 30–300 kg", () => {
    expect(measures("100", "30").ok).toBe(true);
    expect(measures("250", "300").ok).toBe(true);
    expect(measures("99", "29,9")).toEqual({
      ok: false,
      errors: {
        heightCm: "Tiene que estar entre 100 y 250 cm.",
        weightKg: "Tiene que estar entre 30 y 300 kg.",
      },
    });
    expect(measures("251", "301")).toEqual({
      ok: false,
      errors: {
        heightCm: "Tiene que estar entre 100 y 250 cm.",
        weightKg: "Tiene que estar entre 30 y 300 kg.",
      },
    });
  });
});

describe("sexo y fecha de nacimiento", () => {
  const aboutYou = (sex: string, birthDate: string) =>
    validateForm(aboutYouSchema, { sex, birthDate });

  it("pide elegir los dos", () => {
    expect(aboutYou("", "")).toEqual({
      ok: false,
      errors: { sex: "Elegí una opción.", birthDate: "Elegí tu fecha de nacimiento." },
    });
  });

  it("acepta edades de 16 a 100 años, como el Backend", () => {
    expect(aboutYou("male", bornYearsAgo(16)).ok).toBe(true);
    expect(aboutYou("male", bornYearsAgo(100)).ok).toBe(true);
    const outOfRange = {
      ok: false,
      errors: { birthDate: "CalorIA es para personas de 16 a 100 años." },
    };
    expect(aboutYou("male", bornYearsAgo(15))).toEqual(outOfRange);
    expect(aboutYou("male", bornYearsAgo(101))).toEqual(outOfRange);
  });

  it("calcula la edad cumplida como el Backend", () => {
    const today = new Date("2026-04-10T12:00:00Z");
    expect(ageOn("2002-04-10", today)).toBe(24);
    expect(ageOn("2002-04-11", today)).toBe(23);
  });

  it("rechaza un sexo que no es una opción", () => {
    expect(aboutYou("other", "2002-04-10")).toEqual({
      ok: false,
      errors: { sex: "Elegí una opción." },
    });
  });
});

describe("actividad y objetivo", () => {
  it("pide elegir los dos", () => {
    expect(validateForm(routineSchema, { activity: "", goal: "" })).toEqual({
      ok: false,
      errors: { activity: "Elegí tu nivel de actividad.", goal: "Elegí tu objetivo." },
    });
  });
});

describe("perfil completo", () => {
  it("lo que devuelve la API, pasado al form y validado, vuelve igual (sin la zona horaria)", () => {
    const { timezone: _timezone, ...input } = PROFILE;
    expect(validateForm(profileSchema, profileToValues({ ...PROFILE, weightKg: 60.5 }))).toEqual({
      ok: true,
      data: { ...input, weightKg: 60.5 },
    });
  });

  it("para el PATCH, se queda solo con lo que cambió", () => {
    const { timezone: _timezone, ...input } = PROFILE;
    expect(changedFields(PROFILE, input)).toEqual({});
    expect(changedFields(PROFILE, { ...input, weightKg: 58, goal: "lose" })).toEqual({
      weightKg: 58,
      goal: "lose",
    });
  });
});
