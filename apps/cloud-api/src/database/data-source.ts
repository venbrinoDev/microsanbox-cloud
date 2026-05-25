import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { RuntimeHostEntity } from './runtime-host.entity.js';
import { RuntimeEntity } from './runtime.entity.js';
import { PortLeaseEntity } from './port-lease.entity.js';
import { VolumeEntity } from './volume.entity.js';
import { SignedPreviewTokenEntity } from './signed-preview-token.entity.js';
import { RevokedSessionEntity } from '../ssh/entities/revoked-session.entity.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dbPath =
  process.env.MICROSANDBOX_CLOUD_SQLITE_PATH?.trim() ||
  process.env.SQLITE_PATH ||
  'data/microsandbox-cloud.db';
const migrationsGlobs = [
  join(currentDir, 'migrations', '*.js'),
  join(currentDir, 'migrations', '*.ts'),
];

export default new DataSource({
  type: 'sqlite',
  database: dbPath,
  entities: [
    RuntimeHostEntity,
    RuntimeEntity,
    PortLeaseEntity,
    VolumeEntity,
    SignedPreviewTokenEntity,
    RevokedSessionEntity,
  ],
  migrations: migrationsGlobs,
});
