import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.chatMessage.deleteMany();
  await prisma.hand.deleteMany();
  await prisma.tableSeat.deleteMany();
  await prisma.pokerTable.updateMany({ data: { status: "closed" } });

  for (const pair of [
    ["2", "Bob"],
    ["3", "Carol"],
  ]) {
    const tg = pair[0];
    const name = pair[1];
    await prisma.user.upsert({
      where: { telegramId: tg },
      update: { whitelisted: true, name, balance: 10000 },
      create: {
        telegramId: tg,
        name,
        username: "dev_" + tg,
        whitelisted: true,
        balance: 10000,
      },
    });
  }

  const admin = await prisma.user.findUniqueOrThrow({
    where: { telegramId: "1" },
  });
  await prisma.user.update({
    where: { id: admin.id },
    data: { balance: 10000, name: "Alice" },
  });

  console.log("reset ok");
}

main()
  .catch(console.error)
  .then(() => prisma.$disconnect());

