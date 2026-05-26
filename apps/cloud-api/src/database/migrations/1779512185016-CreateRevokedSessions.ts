import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRevokedSessions1779512185016 implements MigrationInterface {
  name = 'CreateRevokedSessions1779512185016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "revoked_sessions" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenHash" varchar NOT NULL,
        "revokedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_revoked_sessions_tokenHash" UNIQUE ("tokenHash")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "revoked_sessions"`);
  }
}
