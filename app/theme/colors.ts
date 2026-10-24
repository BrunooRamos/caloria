export const colors = {
  primary: "#1F5637",
  primaryPressed: "#17432A",
  sage: "#87A27B",
  sageSoft: "#E4EBDF",
  cream: "#F7F4EC",

  background: "#F7F4EC",
  surface: "#FFFFFF",
  surfaceAlt: "#EFEBE0",
  border: "#E2DCCB",
  borderStrong: "#CFC7B3",
  ink: "#17291E",
  inkMuted: "#5E6B62",
  onPrimary: "#FFFFFF",
  onPrimaryMuted: "#E4EBDF",
  onPrimaryDanger: "#F6E3DD",
  sageText: "#4F6A47",
  warning: "#8A5D18",
  warningSoft: "#F3E7D3",
  danger: "#A8452E",
  dangerSoft: "#F6E3DD",
} as const;

export type ColorToken = keyof typeof colors;
