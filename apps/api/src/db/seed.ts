import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import { db, libsql } from "./index.js";
import { games, gameVersions, reviewEvents, users } from "./schema.js";
import { env } from "../env.js";
import { id } from "../lib/ids.js";
import { inspectBundle, extractBundle } from "../lib/bundle.js";
import { slugify } from "../lib/slug.js";
import { storage } from "../storage/index.js";
import { SEED_GAMES } from "./seed-games.js";

/**
 * `npm run db:seed`         -> only creates the admin account (from ADMIN_EMAILS).
 * `npm run db:seed -- --demo` -> also inserts a handful of sample game listings so
 *                                the store isn't empty while you develop.
 *
 * The sample games are illustrative placeholder listings — this platform does not
 * generate games. Real content comes from people submitting their own AI-made games.
 */
const WITH_DEMO = process.argv.includes("--demo");

async function upsertUserRow(input: {
  email: string;
  displayName: string;
  role: "user" | "moderator" | "admin";
}) {
  const existing = await db.select().from(users).where(eq(users.email, input.email)).get();
  if (existing) return existing;
  const row = {
    id: id("user"),
    email: input.email,
    displayName: input.displayName,
    avatarUrl: null,
    role: input.role,
    githubId: null,
    createdAt: Date.now(),
  };
  await db.insert(users).values(row);
  return row;
}

async function createDemoHtmlGame(opts: {
  authorId: string;
  moderatorId: string;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  aiTools: string[];
  html: string;
}) {
  const slug = slugify(opts.title);
  if (await db.select().from(games).where(eq(games.slug, slug)).get()) {
    console.log(`  · ${opts.title} already present, skipping`);
    return;
  }

  const zip = new AdmZip();
  zip.addFile("index.html", Buffer.from(opts.html, "utf8"));
  const buffer = zip.toBuffer();
  const info = inspectBundle(buffer, {
    maxFiles: env.MAX_BUNDLE_FILES,
    maxUnzippedBytes: env.MAX_UNZIPPED_BYTES,
  });

  const gameId = id("game");
  const versionId = id("ver");
  const now = Date.now();
  const bundleKey = await storage.putBundle(versionId, buffer);
  extractBundle(buffer, storage.extractedDir(gameId, versionId));

  await db.insert(games).values({
    id: gameId,
    slug,
    title: opts.title,
    summary: opts.summary,
    description: opts.description,
    tags: JSON.stringify(opts.tags),
    aiTools: JSON.stringify(opts.aiTools),
    status: "approved",
    playType: "html",
    authorId: opts.authorId,
    currentVersionId: versionId,
    screenshots: "[]",
    playCount: Math.floor(Math.random() * 400),
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  });
  await db.insert(gameVersions).values({
    id: versionId,
    gameId,
    version: 1,
    status: "approved",
    changelog: "Initial release",
    playType: "html",
    entryPath: info.entryPath,
    bundleKey,
    bundleBytes: buffer.length,
    unzippedBytes: info.unzippedBytes,
    fileCount: info.fileCount,
    sha256: info.sha256,
    createdAt: now,
    reviewedAt: now,
    reviewedBy: opts.moderatorId,
  });
  await db.insert(reviewEvents).values({
    id: id("rev"),
    gameId,
    versionId,
    moderatorId: opts.moderatorId,
    action: "approve",
    note: "Sample listing.",
    createdAt: now,
  });
  console.log(`  ✓ ${opts.title}`);
}

async function main() {
  const adminEmail = [...env.adminEmails][0] ?? "admin@example.com";
  const admin = await upsertUserRow({
    email: adminEmail,
    displayName: "Arcade Admin",
    role: "admin",
  });
  console.log(`Admin account ready: ${admin.email} (role: admin)`);

  if (!WITH_DEMO) {
    console.log('Done. Run with "-- --demo" to add sample game listings.');
    libsql.close();
    return;
  }

  console.log("Adding demo content …");
  const nova = await upsertUserRow({
    email: "nova@example.com",
    displayName: "Nova Park",
    role: "user",
  });
  const pixel = await upsertUserRow({
    email: "pixel@example.com",
    displayName: "Pixel Okafor",
    role: "user",
  });

  const authors = [nova, pixel];
  for (let i = 0; i < SEED_GAMES.length; i++) {
    await createDemoHtmlGame({
      authorId: authors[i % authors.length]!.id,
      moderatorId: admin.id,
      ...SEED_GAMES[i]!,
    });
  }

  // A pending, first-time submission so the moderation queue isn't empty.
  const pendingSlug = "gravity-golf";
  if (!(await db.select().from(games).where(eq(games.slug, pendingSlug)).get())) {
    const zip = new AdmZip();
    zip.addFile(
      "index.html",
      Buffer.from(
        "<!doctype html><meta charset=utf8><title>Gravity Golf</title><body style='font-family:sans-serif;background:#111;color:#eee;text-align:center;padding-top:20vh'><h1>Gravity Golf</h1><p>Prototype build awaiting review.</p>",
        "utf8",
      ),
    );
    const buffer = zip.toBuffer();
    const info = inspectBundle(buffer, {
      maxFiles: env.MAX_BUNDLE_FILES,
      maxUnzippedBytes: env.MAX_UNZIPPED_BYTES,
    });
    const gameId = id("game");
    const versionId = id("ver");
    const now = Date.now();
    const bundleKey = await storage.putBundle(versionId, buffer);
    extractBundle(buffer, storage.extractedDir(gameId, versionId));
    await db.insert(games).values({
      id: gameId,
      slug: pendingSlug,
      title: "Gravity Golf",
      summary: "Sink putts across tiny planets with their own gravity wells.",
      description: "A physics golf toy — sample submission awaiting review.",
      tags: JSON.stringify(["physics", "golf", "casual"]),
      aiTools: JSON.stringify(["Claude"]),
      status: "pending",
      playType: "html",
      authorId: pixel.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(gameVersions).values({
      id: versionId,
      gameId,
      version: 1,
      status: "pending",
      changelog: "First submission",
      playType: "html",
      entryPath: info.entryPath,
      bundleKey,
      bundleBytes: buffer.length,
      unzippedBytes: info.unzippedBytes,
      fileCount: info.fileCount,
      sha256: info.sha256,
      createdAt: now,
    });
    console.log("  ⧗ Gravity Golf (pending review)");
  }

  // A sample external listing.
  const extSlug = "prompt-quest";
  if (!(await db.select().from(games).where(eq(games.slug, extSlug)).get())) {
    const gameId = id("game");
    const versionId = id("ver");
    const now = Date.now();
    const url = "https://example.com/prompt-quest";
    await db.insert(games).values({
      id: gameId,
      slug: extSlug,
      title: "Prompt Quest",
      summary: "A text adventure where your spells are natural-language prompts.",
      description: "Hosted externally — sample listing.",
      tags: JSON.stringify(["text", "adventure", "rpg"]),
      aiTools: JSON.stringify(["Claude", "Midjourney"]),
      status: "approved",
      playType: "external",
      externalUrl: url,
      authorId: nova.id,
      currentVersionId: versionId,
      playCount: 128,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    });
    await db.insert(gameVersions).values({
      id: versionId,
      gameId,
      version: 1,
      status: "approved",
      changelog: "Listed",
      playType: "external",
      externalUrl: url,
      createdAt: now,
      reviewedAt: now,
      reviewedBy: admin.id,
    });
    console.log("  ✓ Prompt Quest (external)");
  }

  console.log("Done.");
  libsql.close();
}

main().catch((err) => {
  console.error(err);
  libsql.close();
  process.exit(1);
});
