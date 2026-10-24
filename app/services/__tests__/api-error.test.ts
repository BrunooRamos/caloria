import { parseRetryAfter } from "../api-error";

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");

  it("lee segundos", () => {
    expect(parseRetryAfter("120", now)).toBe(120);
    expect(parseRetryAfter(" 7 ", now)).toBe(7);
    expect(parseRetryAfter("0", now)).toBe(0);
  });

  it("lee una fecha HTTP y la pasa a segundos desde ahora, redondeando para arriba", () => {
    expect(parseRetryAfter("Mon, 19 Oct 2026 12:01:30 GMT", now)).toBe(90);
    expect(parseRetryAfter(new Date(now + 1500).toUTCString(), now)).toBe(1);
  });

  it("una fecha que ya pasó es 0", () => {
    expect(parseRetryAfter("Mon, 19 Oct 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("sin header o con un valor que no se entiende devuelve null", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("pronto", now)).toBeNull();
    expect(parseRetryAfter("-5", now)).toBeNull();
    expect(parseRetryAfter("1.5", now)).toBeNull();
  });
});
