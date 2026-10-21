#!/bin/sh
# Prepara el bucket de media. Idempotente: corre en cada `docker compose up`.
# Usa las credenciales root; Back y Worker solo reciben las del usuario de servicio.
set -eu

# `alias set` ya prueba la conexión: se reintenta hasta que MinIO acepta conexiones.
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 1
done

mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"

cat > /tmp/media-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::$S3_BUCKET"] },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET/*"]
    }
  ]
}
POLICY
mc admin policy create local caloria-media /tmp/media-policy.json
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
mc admin policy attach local caloria-media --user "$S3_ACCESS_KEY_ID"
echo "bucket $S3_BUCKET listo (privado)"
