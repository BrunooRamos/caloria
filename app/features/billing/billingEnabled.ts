/**
 * Interruptor de build para el plan premium y los pagos (`EXPO_PUBLIC_BILLING_ENABLED`). Google
 * Play no deja cobrar funciones digitales por fuera de su sistema de pagos ni mandar a pagar a otro
 * lado, así que el build de Play (perfil `production` de eas.json) lo apaga: sin "Ver planes", sin
 * precios y sin las rutas de Tu plan. El plan gratis y su tope siguen igual.
 *
 * Es el único lugar que lee la variable. Sin definir vale `true`; solo `"false"` lo apaga.
 */
export function billingEnabledFrom(value: string | undefined): boolean {
  return value !== "false";
}

/**
 * Se lee en cada llamada (y no una vez al importar) para que los tests puedan probar los dos
 * casos. En el build, Expo reemplaza `process.env.EXPO_PUBLIC_…` por el valor fijo.
 */
export function isBillingEnabled(): boolean {
  return billingEnabledFrom(process.env.EXPO_PUBLIC_BILLING_ENABLED);
}
