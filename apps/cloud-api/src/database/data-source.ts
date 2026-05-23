import { DataSource } from 'typeorm';
import { RuntimeHostEntity } from './runtime-host.entity.js';
import { RuntimeEntity } from './runtime.entity.js';
import { PortLeaseEntity } from './port-lease.entity.js';
import { VolumeEntity } from './volume.entity.js';
import { SignedPreviewTokenEntity } from './signed-preview-token.entity.js';
import { RevokedSessionEntity } from '../ssh/entities/revoked-session.entity.js';

const dbPath = process.env.SQLITE_PATH || 'data/microsandbox-cloud.db';

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
  migrations: ['src/database/migrations/*.ts'],
});
