# Prompts de Martin Sena

## Sesión `957c1600-dbba-4800-9aa3-172966136e04` · 2026-10-21

### 2026-10-21 14:08

```text
Tenemos que implementar este ticket: https://github.com/BrunooRamos/caloria/issues/14, vamos a planificar como tenemos que hacerlo, discutamos decisiones hasta llegar a un plan de implementacion
```

### 2026-10-21 14:19

```text
Perfecto, guarda el plan el prompts/plans linkeado al issue con su nombre
```

### 2026-10-21 14:21

```text
Aprobado el plan, implementalo.
```

## Sesión `1c274a6e-d7ce-478e-aa0a-bf31c5c76a66` · 2026-10-25

### 2026-10-25 21:17

```text
Che, estoy en la rama front-y-nginx-multipart-con-l-mites-de-tama-o-y, que es del issue #16 (multipart con límites de tamaño y tipo). Fijate el issue con gh issue view 16.

Ojo que casi todo ya quedó hecho en el PR #66 (el de post-meals): la validación por contenido en shared/src/meals.ts, multer en memoria en el front, el reenvío al back y el 413 en nginx. No lo rehagas. Faltan unas puntas que quiero cerrar:

1. nginx está escribiendo la foto a disco. En la location de /api/v1/meals el client_body_buffer_size quedó en el default, así que todo lo que pase de 16 KB va a un archivo temporal. Quiero que quede en memoria, así que subilo a 13m como el client_max_body_size. Dejá el buffering prendido (nada de proxy_request_buffering off), así nginx sigue bancando a los clientes lentos.

2. Nunca probamos la config de nginx. Agregá algo al CI que corra nginx -t (con --add-host front:127.0.0.1 para que resuelva el upstream). Sumale un smoke test con curl: un POST de más de 13 MB a /api/v1/meals tiene que devolver 413 con el JSON de PAYLOAD_TOO_LARGE y un requestId igual al header X-Request-Id. Uno chico tiene que pasar. Si queda más prolijo como script en scripts/, metelo ahí, pero que lo pueda correr local con Docker.

3. Una nota larga a veces da 400 y a veces 413. Entre 501 y 2000 caracteres zod la rechaza con 400, pero arriba de 2000 salta el LIMIT_FIELD_VALUE de multer y sale 413. En docs/api.md dijimos que nota larga es 400. Corregilo en toAppError (shared/src/error-handler.ts) y agregá tests en shared y en front. Fijate también que no se rompa nada en los tests del back.

Lo de AAC suelto no lo toques: la app graba m4a y el back necesita el moov para leer la duración.

Mantené el estilo del repo (comentarios cortitos en español) y, si cambia algo documentado, actualizá los docs. Cuando termines, corré lint, typecheck y los tests, y pasame cómo salieron. No commitees todavía, que lo quiero revisar antes.
```

## Sesión `46a8b12e-f90c-494b-aaf5-8215add760c0` · 2026-10-25

### 2026-10-25 21:31

```text
Estoy en la rama del issue #17, el del worker con BullMQ (gh issue view 17 para ver qué pide). Parte ya quedó hecha con el PR de post-meals: la cola meal-analysis y el job { mealId, requestId } están en back-service/src/jobs/meal-analysis.ts, y el servicio worker ya está en el compose. Lo de encolar del lado del Back no lo toques. Lo que falta es que el worker consuma de verdad, porque hoy src/worker.ts es un console.log y nada más.

Lo primero es la config. El worker no puede usar loadConfig porque pide JWT_PRIVATE_KEY, y esa clave no tiene que llegarle al worker. Hacele una config aparte con Mongo, Redis, el storage y una WORKER_CONCURRENCY para la concurrencia. Por defecto que valga 2, y si viene cualquier cosa que no sea un entero positivo, que no arranque. Acordate de agregarla al .env.example y al compose.

El Worker de BullMQ ponelo en jobs/ junto a la cola, usando la misma constante del nombre. Ojo con la conexión: el Worker necesita maxRetriesPerRequest: null en IORedis, así que no reuses la de la cola, que está pensada para fallar rápido. Dejale un prefix opcional como tiene la cola, que nos sirve para los tests.

La lógica de cada job quiero que quede en un processor aparte, para poder testearla sin Redis. Lee la meal de Mongo. Si no existe, logueá un warn y terminá el job sin error, porque reintentar no la va a hacer aparecer. Si ya no está en processing, salteala, así un job repetido no pisa nada. Después baja la foto (y el audio si hay) del bucket. Para eso hace falta un download(key) en el MediaService que devuelva Uint8Array, con timeout como el upload. Si falla Mongo o MinIO, que tire el error y BullMQ reintente con las opciones que ya están. Al final le pasás meal + foto + audio a un analyze que se inyecte desde afuera. Por ahora que no haga nada y deje la meal en processing, que eso lo resolvemos en el #18.

Para los logs usá el logger de shared con service: "worker". Por cada job necesito ver mealId, requestId, el intento y cuánto tardó, salga bien o mal. Si falla, mandá el error con serializeError y que se vea si va a reintentar. Ni la media ni la nota del usuario van al log.

En worker.ts conectá Mongo con connectMongo y arrancá el worker. Con SIGTERM o SIGINT cerrá primero el worker, que espera los jobs que están corriendo, y después Mongo. Si no puede arrancar, que salga con 1 igual que el index.ts. Sumá también un dev:worker en los scripts para levantarlo local.

Los tests del processor hacelos con mongodb-memory-server y un media fake: que la meal no exista, que ya no esté en processing, el caso feliz con foto y audio, y que un error del bucket se propague. Agregá uno contra Redis real que encole con createMealAnalysisQueue y verifique que el worker lo consume, salteándolo si no está REDIS_TEST_URL, como hacen los de meals.test.ts. El download sumalo al test de integración de media.

No te metas con la IA (#18), ni con el estado failed ni el campo attempts (#35), ni con la transcripción (#23).

Comentarios cortitos en español como en el resto del repo, y si algo de lo documentado cambia, actualizá el README del back y docs/arquitectura.md. Al final corré lint, typecheck y los tests y contame cómo salieron. No commitees, que lo quiero revisar primero.
```

## Sesión `eb3014a2-3c9e-4295-9622-b0e71fba2d50` · 2026-10-26

### 2026-10-26 11:13

```text


<pasted_content id="6479">
Logs for your project will appear below. Press Ctrl+C to exit.
TypeScript: The tsconfig.json#include property has been updated
iOS  ERROR  Project is incompatible with this version of Expo Go

• The installed version of Expo Go is for SDK 58.0.0.
• The project you opened uses SDK 57.

How to fix this error:

Either upgrade this project to SDK 58.0.0, or launch it in an iOS simulator. It is not possible to install an older version of Expo Go for iOS devices, only the latest version is supported.

[Learn how to upgrade to SDK 58.](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)

[https://expo.dev/go?sdkVersion=57&platform=ios&device=false](Learn how to install Expo Go for SDK 57 in an iOS Simulator.)
</pasted_content id="6479">


Como haga upgrade del sdk de expo?
```

### 2026-10-26 11:15

```text


<pasted_content id="6479">
martin@192 app % npx expo install --fix
The following packages should be updated for best compatibility with the installed expo version:
  @react-native-community/datetimepicker@9.1.0 - expected version: 9.2.1
  expo-constants@57.0.22 - expected version: ~58.0.13
  expo-linking@57.0.13 - expected version: ~58.0.14
  expo-localization@57.0.2 - expected version: ~58.0.5
  expo-router@57.0.27 - expected version: ~58.0.26
  expo-secure-store@57.0.4 - expected version: ~58.0.2
  expo-splash-screen@57.0.10 - expected version: ~58.0.11
  expo-status-bar@57.0.1 - expected version: ~58.0.4
  react@19.2.3 - expected version: 19.3.0
  react-dom@19.2.3 - expected version: 19.3.0
  react-native@0.86.3 - expected version: 0.88.0
  react-native-reanimated@4.5.1 - expected version: 4.7.1
  react-native-safe-area-context@5.7.0 - expected version: ~5.10.1
  react-native-screens@4.26.2 - expected version: ~4.30.0
  react-native-svg@15.15.4 - expected version: 15.16.0
  react-native-worklets@0.10.1 - expected version: 0.13.0
  @types/jest@29.5.14 - expected version: 30.0.0
  @types/react@19.2.18 - expected version: ~19.3.0
  jest@29.7.0 - expected version: ~30.5.2
  jest-expo@57.0.6 - expected version: ~58.0.12
Your project may not work correctly until you install the expected versions of the packages.
› Installing 20 SDK 58.0.0 compatible native modules using npm
> npm install
npm error code ERESOLVE
npm error ERESOLVE could not resolve
npm error
npm error While resolving: app@1.0.0
npm error Found: @react-native-community/datetimepicker@9.1.0
npm error node_modules/@react-native-community/datetimepicker
npm error   @react-native-community/datetimepicker@"9.2.1" from the root project
npm error
npm error Could not resolve dependency:
npm error @react-native-community/datetimepicker@"9.2.1" from the root project
npm error
npm error Conflicting peer dependency: react-native@0.88.0
npm error node_modules/react-native
npm error   peer react-native@"^0.85.0" from react-native-windows@0.85.0
npm error   node_modules/react-native-windows
npm error     peerOptional react-native-windows@"*" from @react-native-community/datetimepicker@9.2.1
npm error     node_modules/@react-native-community/datetimepicker
npm error       @react-native-community/datetimepicker@"9.2.1" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.
npm error
npm error
npm error For a full report see:
npm error /Users/martin/.npm/_logs/2026-10-26T14_15_24_706Z-eresolve-report.txt
npm error A complete log of this run can be found in: /Users/martin/.npm/_logs/2026-10-26T14_15_24_706Z-debug-0.log
Error: npm install exited with non-zero code: 1
Error: npm install exited with non-zero code: 1
    at ChildProcess.completionListener (/Users/martin/orca/caloria/app/node_modules/@expo/spawn-async/build/spawnAsync.js:113:23)
    at Object.onceWrapper (node:events:623:26)
    at ChildProcess.emit (node:events:508:28)
    at ChildProcess._handle.onexit (node:internal/child_process:294:12)
    ...
    at spawnAsync (/Users/martin/orca/caloria/app/node_modules/@expo/spawn-async/build/spawnAsync.js:9:23)
    at NpmPackageManager.runAsync (/Users/martin/orca/caloria/app/node_modules/@expo/package-manager/build/node/BasePackageManager.js:75:42)
    at /Users/martin/orca/caloria/app/node_modules/@expo/package-manager/build/node/NpmPackageManager.js:68:143
    at /Users/martin/orca/caloria/app/node_modules/@expo/package-manager/build/utils/spawn.js:20:34
</pasted_content id="6479">

```

### 2026-10-26 11:18

```text


<pasted_content id="6479">
> app@1.0.0 typecheck
> tsc --noEmit

__tests__/auth-screens.test.tsx:179:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

179     expect(router.getPathname()).toBe("/onboarding");
                      ~~~~~~~~~~~

  __tests__/auth-screens.test.tsx:179:19
    179     expect(router.getPathname()).toBe("/onboarding");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/auth-screens.test.tsx:194:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

194     expect(router.getPathname()).toBe("/register");
                      ~~~~~~~~~~~

  __tests__/auth-screens.test.tsx:194:19
    194     expect(router.getPathname()).toBe("/register");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:77:10 - error TS2339: Property 'getRouterState' does not exist on type 'Promise<RenderRouterResult>'.

77   router.getRouterState()?.routes[0]?.state?.routes.map((route) => route.name);
            ~~~~~~~~~~~~~~

  __tests__/navigation.test.tsx:77:10
    77   router.getRouterState()?.routes[0]?.state?.routes.map((route) => route.name);
                ~~~~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:77:58 - error TS7006: Parameter 'route' implicitly has an 'any' type.

77   router.getRouterState()?.routes[0]?.state?.routes.map((route) => route.name);
                                                            ~~~~~

__tests__/navigation.test.tsx:101:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

101     expect(router.getPathname()).toBe("/");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:101:19
    101     expect(router.getPathname()).toBe("/");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:114:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

114     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:114:19
    114     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:129:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

129     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:129:19
    129     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:142:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

142     expect(router.getPathname()).toBe("/");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:142:19
    142     expect(router.getPathname()).toBe("/");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:162:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

162     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:162:19
    162     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:181:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

181     expect(router.getPathname()).toBe("/");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:181:19
    181     expect(router.getPathname()).toBe("/");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:193:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

193     expect(router.getPathname()).toBe("/register");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:193:19
    193     expect(router.getPathname()).toBe("/register");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:196:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

196     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:196:19
    196     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:208:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

208     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:208:19
    208     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:221:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

221     expect(router.getPathname()).toBe("/profile");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:221:19
    221     expect(router.getPathname()).toBe("/profile");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:228:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

228     expect(router.getPathname()).toBe("/profile");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:228:19
    228     expect(router.getPathname()).toBe("/profile");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:246:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

246     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:246:19
    246     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/navigation.test.tsx:269:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

269     expect(router.getPathname()).toBe("/login");
                      ~~~~~~~~~~~

  __tests__/navigation.test.tsx:269:19
    269     expect(router.getPathname()).toBe("/login");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/profile-screens.test.tsx:225:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

225     expect(router.getPathname()).toBe("/goals");
                      ~~~~~~~~~~~

  __tests__/profile-screens.test.tsx:225:19
    225     expect(router.getPathname()).toBe("/goals");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

__tests__/profile-screens.test.tsx:278:19 - error TS2339: Property 'getPathname' does not exist on type 'Promise<RenderRouterResult>'.

278     expect(router.getPathname()).toBe("/register");
                      ~~~~~~~~~~~

  __tests__/profile-screens.test.tsx:278:19
    278     expect(router.getPathname()).toBe("/register");
                          ~~~~~~~~~~~
    Did you forget to use 'await'?

components/Input.tsx:63:11 - error TS2322: Type 'Ref<TextInputType> | undefined' is not assignable to type 'Ref<_TextInputInstance> | undefined'.
  Type '(instance: TextInputType | null) => void | (() => VoidOrUndefinedOnly)' is not assignable to type 'Ref<_TextInputInstance> | undefined'.
    Type '(instance: TextInputType | null) => void | (() => VoidOrUndefinedOnly)' is not assignable to type '(instance: _TextInputInstance | null) => void | (() => VoidOrUndefinedOnly)'.
      Types of parameters 'instance' and 'instance' are incompatible.
        Type '_TextInputInstance | null' is not assignable to type 'TextInputType | null'.
          Type '_TextInputInstance' is not assignable to type 'TextInputType'.
            Type '_TextInputInstance' is not assignable to type 'InternalTextInput'.
              Type '_TextInputInstance' provides no match for the signature '(props: Omit<TextInputProps, "ref"> & { ref?: Ref<_TextInputInstance> | undefined; }): ReactNode'.

63           ref={ref}
             ~~~

  node_modules/react-native/types_generated/Libraries/Components/TextInput/TextInput.flow.d.ts:994:3
    994   ref?: React.Ref<TextInputInstance> | undefined;
          ~~~
    The expected type comes from property 'ref' which is declared here on type 'IntrinsicAttributes & Omit<TextInputProps, "ref"> & { ref?: Ref<_TextInputInstance> | undefined; }'

features/auth/LoginScreen.tsx:49:55 - error TS2339: Property 'focus' does not exist on type 'TextInputType'.

49           onSubmitEditing={() => passwordRef.current?.focus()}
                                                         ~~~~~

features/auth/RegisterScreen.tsx:54:55 - error TS2339: Property 'focus' does not exist ontype 'TextInputType'.

54           onSubmitEditing={() => passwordRef.current?.focus()}
                                                         ~~~~~

features/auth/RegisterScreen.tsx:69:62 - error TS2339: Property 'focus' does not exist ontype 'TextInputType'.

69           onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                                                                ~~~~~

features/onboarding/MeasuresStep.tsx:41:51 - error TS2339: Property 'focus' does not exist on type 'TextInputType'.

41         onSubmitEditing={() => weightRef.current?.focus()}
                                                     ~~~~~

features/profile/ProfileScreen.tsx:110:55 - error TS2339: Property 'focus' does not existon type 'TextInputType'.

110             onSubmitEditing={() => weightRef.current?.focus()}
                                                          ~~~~~


Found 25 errors in 8 files.

Errors  Files
     2  __tests__/auth-screens.test.tsx:179
    15  __tests__/navigation.test.tsx:77
     2  __tests__/profile-screens.test.tsx:225
     1  components/Input.tsx:63
     1  features/auth/LoginScreen.tsx:49
     2  features/auth/RegisterScreen.tsx:54
     1  features/onboarding/MeasuresStep.tsx:41
     1  features/profile/ProfileScreen.tsx:110
</pasted_content id="6479">

```

## Sesión `eb65d411-15ce-4492-9bd8-4efaba402b67` · 2026-10-26

### 2026-10-26 11:23

```text
Como levanto el proyecto completo, con la app novil tambien
```

### 2026-10-26 11:28

```text
Pero como levanto todo el backend?
```

## Sesión `eb3014a2-3c9e-4295-9622-b0e71fba2d50` · 2026-10-26

### 2026-10-26 11:33

```text
dale
```
