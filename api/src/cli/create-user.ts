// Creates a back-office account, or updates it when the email already exists.
//
//   npm run user:create -- <email> <REVIEWER|ADMIN> "<display name>"
//
// The password is typed at a hidden prompt, or piped on stdin for scripts.
// It is never taken as an argument, so it does not end up in shell history.
import { createInterface } from 'node:readline';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../auth/password.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

const MIN_PASSWORD = 12;

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, '');
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // Echo nothing while the password is typed.
  const output = rl as unknown as {
    _writeToOutput: (text: string) => void;
    output: NodeJS.WriteStream;
  };
  let prompted = false;
  output._writeToOutput = (text) => {
    if (!prompted) {
      output.output.write(text);
      prompted = true;
    }
  };
  return new Promise((resolve) =>
    rl.question('Password: ', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

async function main(): Promise<void> {
  const [email, role, ...nameParts] = process.argv.slice(2);
  const displayName = nameParts.join(' ').trim();
  if (!email || !displayName || !(role in Role)) {
    console.error(
      'Usage: npm run user:create -- <email> <REVIEWER|ADMIN> "<display name>"',
    );
    process.exit(1);
  }
  const password = await readPassword();
  if (password.length < MIN_PASSWORD) {
    console.error(`Password must be at least ${MIN_PASSWORD} characters.`);
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        displayName,
        role: role as Role,
        passwordHash,
      },
      update: { displayName, role: role as Role, passwordHash },
    });
    console.log(`${user.role} ${user.email} (${user.displayName}) is ready.`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
