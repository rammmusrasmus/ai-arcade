import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/index.js";
import { badRequest, payloadTooLarge } from "../lib/errors.js";
import { id } from "../lib/ids.js";
import { rateLimit } from "../lib/rateLimit.js";
import { storage } from "../storage/index.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: ".png", mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: ".jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ".gif", mime: "image/gif", test: (b) => b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a" },
  {
    ext: ".webp",
    mime: "image/webp",
    test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export async function uploadRoutes(app: FastifyInstance) {
  app.post(
    "/uploads/image",
    { preHandler: rateLimit("upload-image", 80, 60 * 60_000) },
    async (req) => {
    requireUser(req);
    const file = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
    if (!file) throw badRequest('Missing "image" file part');

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk);
    if (file.file.truncated) throw payloadTooLarge("Image exceeds 5 MB");
    const buffer = Buffer.concat(chunks);

    const sig = SIGNATURES.find((s) => s.test(buffer));
    if (!sig) throw badRequest("Unsupported image type (png, jpeg, gif, webp only)");

    const url = await storage.putImage(id("img"), sig.ext, buffer);
    return { url };
    },
  );
}
