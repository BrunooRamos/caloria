import { screen } from "expo-router/testing-library";

const KEY = "EXPO_PUBLIC_BILLING_ENABLED";

/**
 * Fija `EXPO_PUBLIC_BILLING_ENABLED` para los tests del bloque y la deja como estaba al terminar.
 * `undefined` la deja sin definir (como en dev).
 */
export function billingSwitch(value: string | undefined) {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[KEY];
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
  });
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });
}

/** Lo que no puede aparecer sin pagos (build de Google Play): planes, precios, suscribirse, pagar. */
export const PAYMENT_WORDS = /premium|ver planes|precio|suscrib|pagar|pago|US\$|cobr/i;

/** Ningún texto ni botón en pantalla habla de pagos. */
export function expectNoPaymentText() {
  expect(screen.queryAllByText(PAYMENT_WORDS, { includeHiddenElements: true })).toEqual([]);
  expect(screen.queryAllByLabelText(PAYMENT_WORDS, { includeHiddenElements: true })).toEqual([]);
}
