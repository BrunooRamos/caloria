import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

/**
 * La vuelta del checkout por deep link (`caloria://billing/return?result=success|cancel`): lleva a
 * Tu plan, que con `checkout=success` muestra que se está confirmando el pago. Si Tu plan ya estaba
 * abierta vuelve a esa, sin apilar otra.
 */
export default function CheckoutReturn() {
  const { result } = useLocalSearchParams<{ result?: string }>();
  useEffect(() => {
    router.dismissTo({
      pathname: "/plan",
      params: result === "success" ? { checkout: "success" } : {},
    });
  }, [result]);
  return null;
}
