import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const bonus = Number(process.env.SIGNUP_BONUS_CHIPS ?? 10_000);
  const adminTg = (process.env.ADMIN_TELEGRAM_IDS ?? "1").split(",")[0].trim();

  const admin = await prisma.user.upsert({
    where: { telegramId: adminTg },
    update: { role: "admin", whitelisted: true },
    create: {
      telegramId: adminTg,
      name: "Admin",
      username: "admin",
      role: "admin",
      whitelisted: true,
      balance: bonus,
    },
  });

  const existingLedger = await prisma.ledgerEntry.findFirst({
    where: { userId: admin.id, kind: "signup_bonus" },
  });
  if (!existingLedger) {
    await prisma.ledgerEntry.create({
      data: {
        userId: admin.id,
        kind: "signup_bonus",
        amount: bonus,
        meta: JSON.stringify({ note: "seed" }),
      },
    });
  }

  const code = `CLUB-${randomBytes(3).toString("hex").toUpperCase()}`;
  const invite = await prisma.invite.create({
    data: {
      code,
      maxUses: 50,
      createdById: admin.id,
    },
  });

  console.log("Seed OK");
  console.log(`Admin telegramId: ${admin.telegramId}`);
  console.log(`Invite code: ${invite.code}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
