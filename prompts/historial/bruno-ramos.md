# Prompts de Bruno Ramos

## Sesión `36a4bfc2-6ad1-4dad-9fbf-a59ba6aca37c` · 2026-10-07

### 2026-10-07 19:21

```text
https://github.com/BrunooRamos/caloria/issues/3
```

### 2026-10-12 18:28

```text
Sí, hacé commit en esta rama, push y abrí el PR contra main con 'Closes #3' en la descripción. Incluí en el PR las decisiones a revisar (syncIndexes, falta volumen de Mongo, worker sin conexión). Si el PR #51 (lint/typecheck) afecta tu código, mencionalo. No mergees.
```

## Sesión `67faad11-fa6c-4514-91bd-5f38c2647a50` · 2026-10-14

### 2026-10-14 19:35

```text
https://github.com/BrunooRamos/caloria/issues/7 

Esto
```

### 2026-10-14 19:36

```text
quien lo implemento?
```

### 2026-10-14 19:38

```text
Estas seguro que esta hecho?
```

### 2026-10-14 19:39

```text
Podemos seguir con este:

https://github.com/BrunooRamos/caloria/issues/8
```

### 2026-10-14 19:42

```text
Revisa por favor que todo este bien, se cumpla con lo que se pide y ademas no dejes comentarios.
```

### 2026-10-14 19:43

```text
Listo, abri PR
```

## Sesión `f000fb76-b327-459e-aee6-aee323cea8c0` · 2026-10-14

### 2026-10-14 19:47

```text
Arranquemos con el issue 9 https://github.com/BrunooRamos/caloria/issues/9 que es el front service como entrada de la api

La idea es que el front no tenga logica de negocio, solo revisa que el pedido venga bien y se lo pasa al backend. Antes de empezar fijate como quedo lo de auth en el PR anterior y reutiliza lo que ya hay (el sobre de error, AppError y los esquemas de shared)

Lo que tengo pensado:
- register, login y refresh son publicos. refresh tiene que ser publico si o si porque se usa justo cuando el token ya vencio
- lo demas (logout y /users/me) pide token. si no viene o es invalido tira 401 y ni llega al back. Que se diferencie cuando esta vencido asi la app sabe que tiene que refrescar
- todo lo que entra se valida con zod), si mandan algo de mas o mal armado 400 ahi mismo
- al back le pasamos solo lo validado. En las rutas con token le reenviamos el mismo token para que lo vuelva a verificar, en las publicas no le mandamos nada de auth que venga del cliente
- lo que conteste el back se devuelve tal cual
- el front no tiene que poder llegar a mongo, redis ni a la clave privada. Quiero que eso quede tambien en el docker-compose, no solo en el codigo
- en logout el refresh token viene en el body, actualiza docs/api.md con eso

Agrega tests para cada criterio del issue y para los casos raros: token vencido, token firmado con otra clave y un campo de mas en la query
```

