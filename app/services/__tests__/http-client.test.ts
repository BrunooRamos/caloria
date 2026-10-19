import { ApiError } from "../api-error";
import { createHttpClient } from "../http-client";
import type { AuthTokens } from "../token-storage";
import {
  BASE_URL,
  NEW_TOKENS,
  OLD_TOKENS,
  apiError,
  deferred,
  fakeFetch,
  json,
  memoryStorage,
  rotatingBackend,
} from "@/test-utils/fake-api";
import type { Handler } from "@/test-utils/fake-api";

/** Deja correr las promesas pendientes. */
function flush(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

function setup(handler: Handler, tokens: AuthTokens | null = OLD_TOKENS) {
  const storage = memoryStorage(tokens);
  const { fetch, calls } = fakeFetch(handler);
  const client = createHttpClient({ baseUrl: BASE_URL, storage, fetch });
  const onSessionExpired = jest.fn();
  client.onSessionExpired(onSessionExpired);

  const pathsCalled = () => calls.map((call) => call.path);
  const refreshCount = () => pathsCalled().filter((path) => path === "/auth/refresh").length;
  return { client, storage, calls, onSessionExpired, pathsCalled, refreshCount };
}

describe("requests", () => {
  it("agrega el Bearer, arma la URL y devuelve el JSON", async () => {
    const { client, calls } = setup(() => json(200, { id: "u1" }));

    await expect(client.get<{ id: string }>("/users/me")).resolves.toEqual({ id: "u1" });
    expect(calls[0]).toMatchObject({
      path: "/users/me",
      method: "GET",
      headers: { Authorization: "Bearer access-old" },
    });
  });

  it("serializa objetos como JSON", async () => {
    const { client, calls } = setup(() => json(200, {}));

    await client.patch("/meals/m1", { dish: "Milanesa" });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toBe(JSON.stringify({ dish: "Milanesa" }));
  });

  it("manda FormData tal cual, sin Content-Type, para que fetch arme el boundary", async () => {
    const { client, calls } = setup(() => json(202, { mealId: "m1", status: "processing" }));
    const form = new FormData();
    form.append("note", "milanesa con puré");

    await expect(client.post("/meals", form)).resolves.toEqual({
      mealId: "m1",
      status: "processing",
    });
    expect(calls[0].body).toBe(form);
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
    expect(calls[0].headers.Authorization).toBe("Bearer access-old");
  });

  it("devuelve undefined en un 204", async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));

    await expect(client.delete("/meals/m1")).resolves.toBeUndefined();
  });

  it("con auth: false no manda Bearer", async () => {
    const { client, calls } = setup(() => json(200, {}));

    await client.post("/auth/login", { email: "a@b.c", password: "12345678" }, { auth: false });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});

describe("errores", () => {
  it("convierte el sobre de error en ApiError con status, code, message y requestId", async () => {
    const { client } = setup(() => apiError(402, "MEAL_QUOTA_EXCEEDED", "req-42"));

    const error = await client.get("/billing/plan").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 402,
      code: "MEAL_QUOTA_EXCEEDED",
      message: "mensaje de MEAL_QUOTA_EXCEEDED",
      requestId: "req-42",
    });
  });

  it("una respuesta sin sobre da UNKNOWN_ERROR con el requestId del header", async () => {
    const { client } = setup(
      () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "X-Request-Id": "r-9" },
        }),
    );

    await expect(client.get("/users/me")).rejects.toMatchObject({
      status: 502,
      code: "UNKNOWN_ERROR",
      requestId: "r-9",
    });
  });

  it("una falla de red da NETWORK_ERROR con status 0", async () => {
    const { client } = setup(() => {
      throw new TypeError("Network request failed");
    });

    await expect(client.get("/users/me")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      requestId: null,
    });
  });
});

describe("refresh de tokens", () => {
  it("con TOKEN_EXPIRED refresca, guarda el par nuevo y reintenta la request una vez", async () => {
    const { client, calls, storage, onSessionExpired, pathsCalled } = setup(rotatingBackend());

    await expect(client.get("/users/me")).resolves.toEqual({ path: "/users/me" });

    expect(pathsCalled()).toEqual(["/users/me", "/auth/refresh", "/users/me"]);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].headers.Authorization).toBeUndefined();
    expect(calls[1].body).toBe(JSON.stringify({ refreshToken: "refresh-1" }));
    expect(calls[2].headers.Authorization).toBe("Bearer access-new");
    expect(storage.current()).toEqual(NEW_TOKENS);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el refresh, limpia la sesión y avisa para volver al login", async () => {
    const { client, storage, onSessionExpired, pathsCalled } = setup(
      rotatingBackend(() => apiError(401, "UNAUTHORIZED")),
    );

    await expect(client.get("/users/me")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(pathsCalled()).toEqual(["/users/me", "/auth/refresh"]);
    expect(storage.current()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sin red", () => Promise.reject(new TypeError("Network request failed"))],
    ["con 503", () => apiError(503, "SERVICE_UNAVAILABLE")],
    ["con 429", () => apiError(429, "RATE_LIMITED")],
  ])("si el refresh falla %s, conserva la sesión", async (_label, refresh) => {
    const { client, storage, onSessionExpired } = setup(rotatingBackend(refresh));

    await expect(client.get("/users/me")).rejects.toBeInstanceOf(ApiError);
    expect(storage.current()).toEqual(OLD_TOKENS);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("dos requests concurrentes con TOKEN_EXPIRED comparten un único refresh", async () => {
    const refreshResponse = deferred<Response>();
    const { client, refreshCount, storage } = setup(rotatingBackend(() => refreshResponse.promise));

    const first = client.get("/users/me");
    const second = client.get("/dashboard/daily");
    await flush();
    // Las dos ya recibieron el 401 y están esperando el mismo refresh.
    expect(refreshCount()).toBe(1);

    refreshResponse.resolve(json(200, { ...NEW_TOKENS }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { path: "/users/me" },
      { path: "/dashboard/daily" },
    ]);
    expect(refreshCount()).toBe(1);
    expect(storage.current()).toEqual(NEW_TOKENS);
  });

  it("si el refresh concurrente es rechazado, las dos fallan y se avisa una sola vez", async () => {
    const { client, refreshCount, onSessionExpired } = setup(
      rotatingBackend(() => apiError(401, "UNAUTHORIZED")),
    );

    const results = await Promise.allSettled([client.get("/users/me"), client.get("/meals")]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(refreshCount()).toBe(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("si otra request ya refrescó, reintenta con el token nuevo sin volver a refrescar", async () => {
    const lateExpired = deferred<Response>();
    let protectedCalls = 0;
    const backend = rotatingBackend();
    const { client, refreshCount } = setup((call) => {
      // La primera respuesta de /meals llega tarde, cuando el refresh ya terminó.
      if (call.path === "/meals" && protectedCalls++ === 0) return lateExpired.promise;
      return backend(call);
    });

    const late = client.get("/meals");
    await expect(client.get("/users/me")).resolves.toEqual({ path: "/users/me" });
    lateExpired.resolve(apiError(401, "TOKEN_EXPIRED"));

    await expect(late).resolves.toEqual({ path: "/meals" });
    expect(refreshCount()).toBe(1);
  });

  it("un 401 que no es TOKEN_EXPIRED no refresca", async () => {
    const { client, storage, onSessionExpired, pathsCalled } = setup(() =>
      apiError(401, "UNAUTHORIZED"),
    );

    await expect(client.get("/users/me")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(pathsCalled()).toEqual(["/users/me"]);
    expect(storage.current()).toEqual(OLD_TOKENS);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("reintenta una sola vez: si el reintento vuelve con TOKEN_EXPIRED, falla", async () => {
    const { client, refreshCount, pathsCalled } = setup((call) =>
      call.path === "/auth/refresh" ? json(200, { ...NEW_TOKENS }) : apiError(401, "TOKEN_EXPIRED"),
    );

    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(pathsCalled()).toEqual(["/users/me", "/auth/refresh", "/users/me"]);
    expect(refreshCount()).toBe(1);
  });

  it("nunca refresca sobre los endpoints de /auth", async () => {
    const { client, refreshCount } = setup(() => apiError(401, "TOKEN_EXPIRED"));

    await expect(client.post("/auth/logout", {})).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    await expect(client.post("/auth/login", {}, { auth: false })).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    expect(refreshCount()).toBe(0);
  });

  it("un logout durante el refresh no revive la sesión", async () => {
    const refreshResponse = deferred<Response>();
    const { client, storage, onSessionExpired } = setup(
      rotatingBackend(() => refreshResponse.promise),
    );

    const pending = client.get("/users/me");
    await flush();
    await client.clearSession();
    refreshResponse.resolve(json(200, { ...NEW_TOKENS }));

    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect(storage.current()).toBeNull();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("refreshSession sin tokens guardados falla sin llamar a la API", async () => {
    const { client, pathsCalled } = setup(() => json(200, { ...NEW_TOKENS }), null);

    await expect(client.refreshSession()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(pathsCalled()).toEqual([]);
  });
});
