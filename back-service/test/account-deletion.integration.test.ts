import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { createLogger } from "@caloria/shared";
import { createAccountPurgeProcessor } from "../src/jobs/account-deletion-processor";
import { GamificationModel } from "../src/models/Gamification";
import { MealModel } from "../src/models/Meal";
import { UserModel } from "../src/models/User";
import { WeeklySummaryModel } from "../src/models/WeeklySummary";
import { createAccountDeletionService } from "../src/services/account-deletion";
import { createMediaService } from "../src/services/media";
import { createOwner } from "./helpers";

// Contra un MinIO real, como media.integration.test.ts (ver back-service/README.md). Sin
// S3_TEST_ENDPOINT se saltea.
const endpoint = process.env.S3_TEST_ENDPOINT;
const silent = createLogger({ service: "test", write: () => undefined });

describe(
  "back-service: borrado de cuenta contra MinIO (RNF-04)",
  { skip: !endpoint && "falta S3_TEST_ENDPOINT" },
  () => {
    const bucket = process.env.S3_TEST_BUCKET ?? "caloria-media";
    const credentials = {
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
    };
    const media = createMediaService({
      endpoint: endpoint!,
      publicEndpoint: endpoint!,
      region: "us-east-1",
      bucket,
      ...credentials,
    });
    const s3 = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials });
    let mongo: MongoMemoryServer;

    before(async () => {
      mongo = await MongoMemoryServer.create();
      await mongoose.connect(mongo.getUri());
    });
    after(async () => {
      await mongoose.disconnect();
      await mongo.stop();
    });

    /** Las keys de una cuenta en el bucket, ordenadas. */
    async function keysOf(userId: string): Promise<string[]> {
      const page = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: `users/${userId}/` }),
      );
      return (page.Contents ?? []).map(({ Key }) => Key!).sort();
    }

    /** Cuenta con dos comidas (una con audio), un Wrapped y la racha, con la media en MinIO. */
    async function seed() {
      const owner = await createOwner();
      const userId = owner.toString();
      for (const withAudio of [true, false]) {
        const mealId = new Types.ObjectId();
        const upload = (kind: "photo" | "audio") =>
          media.upload({
            userId,
            mealId: mealId.toString(),
            kind,
            body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(32)]),
            contentType: kind === "photo" ? "image/jpeg" : "audio/mp4",
          });
        const photoKey = await upload("photo");
        const audioKey = withAudio ? await upload("audio") : undefined;
        await MealModel.create({
          _id: mealId,
          userId: owner,
          capturedAt: new Date(),
          localDate: "2026-11-09",
          status: "processing",
          media: { photoKey, ...(audioKey && { audioKey }) },
        });
      }
      await WeeklySummaryModel.create({ userId: owner, week: "2026-W45", status: "failed" });
      await GamificationModel.create({
        userId: owner,
        streak: { current: 1, best: 1, lastLogDate: "2026-11-09" },
      });
      return { owner, userId };
    }

    async function snapshot({ owner, userId }: { owner: Types.ObjectId; userId: string }) {
      const keys = await keysOf(userId);
      return {
        user: await UserModel.findById(owner).lean(),
        meals: await MealModel.find({ userId: owner }).sort({ _id: 1 }).lean(),
        summaries: await WeeklySummaryModel.find({ userId: owner }).lean(),
        gamification: await GamificationModel.find({ userId: owner }).lean(),
        media: await Promise.all(keys.map(async (key) => [key, await media.download(key)])),
      };
    }

    it("borra todo lo de una cuenta y nada de la otra, documentos y objetos", async () => {
      const ana = await seed();
      const beto = await seed();
      const before = await snapshot(beto);
      assert.equal(before.media.length, 3);
      assert.equal((await keysOf(ana.userId)).length, 3);

      const accounts = createAccountDeletionService({
        billing: { closeCustomer: async () => undefined },
        enqueuePurge: async () => undefined,
      });
      await accounts.deleteAccount(ana.userId, { requestId: "r", log: silent });
      const purge = createAccountPurgeProcessor({ media });
      assert.equal(await purge({ userId: ana.userId }, silent), "purged");

      assert.deepEqual(await keysOf(ana.userId), []);
      assert.equal(await UserModel.countDocuments({ _id: ana.owner }), 0);
      assert.equal(await MealModel.countDocuments({ userId: ana.owner }), 0);
      assert.equal(await WeeklySummaryModel.countDocuments({ userId: ana.owner }), 0);
      assert.equal(await GamificationModel.countDocuments({ userId: ana.owner }), 0);
      assert.deepEqual(await snapshot(beto), before);
    });
  },
);
