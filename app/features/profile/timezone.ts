import { getCalendars } from "expo-localization";

/*Zona IANA del dispositivo, para que el día y la racha se calculen en la hora del usuario.
 `getCalendars` puede no traerla (en web); ahí se usa la de `Intl`.*/
export function deviceTimeZone(): string {
  return getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
