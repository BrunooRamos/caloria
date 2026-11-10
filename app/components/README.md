# components — Capa 1 · Cliente: componentes de UI reutilizables.

Cómo y cuándo usar cada uno está en la skill `caloria-design` (secciones 5 y 5b). Los de navegación:

- `TabBar` y `tabIcon`: la barra de pestañas de `(tabs)/_layout.tsx`, con la acción "Registrar" en el medio.
- `ScreenHeader`, `HeaderButton`, `goBack` y `goHome`: el header de los detalles ("‹ Volver") y el "✕ Cerrar" de la cámara.
- `Toast` (`ToastProvider`, `useToast`): la confirmación breve después de guardar, borrar o corregir.
- `ListGroup` y `ListRow`: menús estilo configuración, como el perfil.
- `Notice`: estados vacíos, de espera o de error con su acción.
- `Sheet`: hoja desde abajo para un aviso con acciones de la app (por ejemplo, sin análisis en el mes).
- `confirmAction`: el diálogo del sistema antes de borrar o descartar.
