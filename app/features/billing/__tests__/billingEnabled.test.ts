import { billingSwitch } from "@/test-utils/billing";
import { billingEnabledFrom, isBillingEnabled } from "../billingEnabled";

describe("EXPO_PUBLIC_BILLING_ENABLED", () => {
  it.each([
    [undefined, true],
    ["true", true],
    ["", true],
    ["1", true],
    ["FALSE", true],
    ["false", false],
  ])('%p → %p: solo "false" lo apaga', (value, enabled) => {
    expect(billingEnabledFrom(value)).toBe(enabled);
  });

  describe("sin definir", () => {
    billingSwitch(undefined);
    it("los pagos quedan prendidos (dev sigue igual)", () => {
      expect(isBillingEnabled()).toBe(true);
    });
  });

  describe("en false (build de Google Play)", () => {
    billingSwitch("false");
    it("los pagos quedan apagados", () => {
      expect(isBillingEnabled()).toBe(false);
    });
  });
});
