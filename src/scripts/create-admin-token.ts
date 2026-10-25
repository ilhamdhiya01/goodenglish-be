// Creates an ADMIN access token and prints it once. Used to bootstrap the
// very first admin (every other token is created from the dashboard).
//
//   local:  pnpm token:admin "Ilham"
//   VPS:    docker compose run --rm app node dist/src/scripts/create-admin-token.js "Ilham"
//
// The plaintext is never stored — if it's lost, run this again (and revoke
// the old one from the dashboard).
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommonModule } from '../common/common.module';
import { AdminModule } from '../modules/admin/admin.module';
import { AdminTokensService } from '../modules/admin/admin-tokens.service';

@Module({ imports: [CommonModule, AdminModule] })
class ScriptModule {}

async function main() {
  const label = process.argv[2]?.trim() || 'Admin';
  const app = await NestFactory.createApplicationContext(ScriptModule, {
    logger: ['error', 'warn'],
  });
  try {
    const { token, item } = await app
      .get(AdminTokensService)
      .createAdmin(label);
    console.log('\nAdmin token created for "%s" (%s)', item.label, item.id);
    console.log('Copy it now — it will not be shown again:\n');
    console.log('  %s\n', token);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
