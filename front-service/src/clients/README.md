# clients — Capa 2 · DMZ: cliente HTTP hacia el Back Service (:4000, HTTPS con mTLS).

`src/index.ts` le pasa un `Agent` de undici con la CA propia y el certificado del Front (ver "mTLS hacia el Backend" en el README del servicio). Los tests usan el cliente sin `dispatcher` contra un Backend falso por HTTP.
