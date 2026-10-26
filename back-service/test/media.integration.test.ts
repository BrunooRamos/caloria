import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createMediaService } from "../src/services/media";

// Contra un MinIO real (ver back-service/README.md). Sin S3_TEST_ENDPOINT se saltea.
const endpoint = process.env.S3_TEST_ENDPOINT;

describe(
  "back-service: media contra MinIO",
  { skip: !endpoint && "falta S3_TEST_ENDPOINT" },
  () => {
    const bucket = process.env.S3_TEST_BUCKET ?? "caloria-media";
    const media = createMediaService({
      endpoint: endpoint!,
      publicEndpoint: endpoint!,
      region: "us-east-1",
      bucket,
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
    });
    const userId = randomUUID();
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    it("sube, descarga, sirve con URL firmada y borra", async () => {
      const key = await media.upload({
        userId,
        mealId: randomUUID(),
        kind: "photo",
        body: photo,
        contentType: "image/jpeg",
      });
      assert.match(key, new RegExp(`^users/${userId}/meals/[0-9a-f-]+/photo\\.jpg$`));

      const res = await fetch(await media.signedUrl(key));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      assert.deepEqual(new Uint8Array(await res.arrayBuffer()), photo);
      assert.deepEqual(await media.download(key), photo);

      await media.remove(key);
      assert.equal((await fetch(await media.signedUrl(key))).status, 404);
      await assert.rejects(media.download(key), { name: "NoSuchKey" });
      await media.remove(key); // idempotente
    });

    it("el bucket no permite acceso anónimo", async () => {
      const key = await media.upload({
        userId,
        mealId: randomUUID(),
        kind: "photo",
        body: photo,
        contentType: "image/jpeg",
      });
      assert.equal((await fetch(`${endpoint}/${bucket}/${key}`)).status, 403);
      assert.equal((await fetch(`${endpoint}/${bucket}?list-type=2`)).status, 403);
      await media.remove(key);
    });

    it("una URL vencida no sirve", async () => {
      const key = await media.upload({
        userId,
        mealId: randomUUID(),
        kind: "photo",
        body: photo,
        contentType: "image/jpeg",
      });
      const url = await media.signedUrl(key, 1);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      assert.equal((await fetch(url)).status, 403);
      await media.remove(key);
    });

    it("removeUserMedia borra solo la media de ese usuario", async () => {
      const other = randomUUID();
      const mine = await Promise.all([
        media.upload({
          userId,
          mealId: randomUUID(),
          kind: "photo",
          body: photo,
          contentType: "image/png",
        }),
        media.upload({
          userId,
          mealId: randomUUID(),
          kind: "audio",
          body: photo,
          contentType: "audio/mp4",
        }),
      ]);
      const theirs = await media.upload({
        userId: other,
        mealId: randomUUID(),
        kind: "photo",
        body: photo,
        contentType: "image/jpeg",
      });

      await media.removeUserMedia(userId);
      for (const key of mine) assert.equal((await fetch(await media.signedUrl(key))).status, 404);
      assert.equal((await fetch(await media.signedUrl(theirs))).status, 200);
      await media.removeUserMedia(other);
    });
  },
);
