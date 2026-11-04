/**
 * Mock manual de `expo-notifications`: el automático de jest-expo no alcanza para
 * `setNotificationHandler`. Jest lo usa solo en todas las suites; las que prueban avisos
 * controlan el permiso, el token y los toques con `mockNotifications`.
 */
type Listener = (response: unknown) => void;

const DEFAULT_PERMISSION = { status: "undetermined", granted: false, canAskAgain: true };

interface MockState {
  permission: Record<string, unknown>;
  afterRequest: Record<string, unknown>;
  token: string | Error;
  lastResponse: unknown;
  listeners: Set<Listener>;
}

// El estado vive en `globalThis`: si Jest carga el módulo más de una vez (el test y las
// rutas de expo-router), todas las copias ven el mismo permiso, token y toques.
const shared = globalThis as typeof globalThis & {
  __expoNotificationsMock?: MockState;
  __expoNotificationsFns?: Record<string, jest.Mock>;
};
const state = (shared.__expoNotificationsMock ??= {
  permission: { ...DEFAULT_PERMISSION },
  afterRequest: { status: "granted", granted: true, canAskAgain: true },
  token: "ExponentPushToken[device-1]",
  lastResponse: null,
  listeners: new Set<Listener>(),
});

export const DEFAULT_ACTION_IDENTIFIER = "expo.modules.notifications.actions.DEFAULT";
export const PermissionStatus = {
  GRANTED: "granted",
  UNDETERMINED: "undetermined",
  DENIED: "denied",
} as const;
export const IosAuthorizationStatus = {
  NOT_DETERMINED: 0,
  DENIED: 1,
  AUTHORIZED: 2,
  PROVISIONAL: 3,
  EPHEMERAL: 4,
} as const;
export const AndroidImportance = { DEFAULT: 3, HIGH: 4, MAX: 5 } as const;

// Los spies también se comparten, para que las aserciones del test vean las llamadas de la app.
const fns = (shared.__expoNotificationsFns ??= {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => state.permission),
  requestPermissionsAsync: jest.fn(async () => {
    state.permission = state.afterRequest;
    return state.permission;
  }),
  getExpoPushTokenAsync: jest.fn(async () => {
    if (state.token instanceof Error) throw state.token;
    return { type: "expo", data: state.token };
  }),
  getLastNotificationResponse: jest.fn(() => state.lastResponse),
  clearLastNotificationResponse: jest.fn(() => {
    state.lastResponse = null;
  }),
  addNotificationResponseReceivedListener: jest.fn((listener: Listener) => {
    state.listeners.add(listener);
    return { remove: () => state.listeners.delete(listener) };
  }),
});

export const {
  setNotificationHandler,
  setNotificationChannelAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  getLastNotificationResponse,
  clearLastNotificationResponse,
  addNotificationResponseReceivedListener,
} = fns;

/** Arma la respuesta de tocar un aviso con este `data`. */
export function tapResponse(data: Record<string, unknown>, identifier = "notif-1") {
  return {
    actionIdentifier: DEFAULT_ACTION_IDENTIFIER,
    notification: { request: { identifier, content: { title: "", body: "", data } } },
  };
}

export const mockNotifications = {
  setPermission(permission: Record<string, unknown>) {
    state.permission = permission;
  },
  /** Lo que contesta el usuario en el diálogo del sistema. */
  answerRequestWith(permission: Record<string, unknown>) {
    state.afterRequest = permission;
  },
  setToken(token: string | Error) {
    state.token = token;
  },
  /** El aviso que abrió la app desde cerrada. */
  setLastResponse(response: unknown) {
    state.lastResponse = response;
  },
  /** Un toque con la app abierta. */
  tap(response: unknown) {
    state.listeners.forEach((listener) => listener(response));
  },
  reset() {
    state.permission = { ...DEFAULT_PERMISSION };
    state.afterRequest = { status: "granted", granted: true, canAskAgain: true };
    state.token = "ExponentPushToken[device-1]";
    state.lastResponse = null;
    state.listeners.clear();
  },
};
