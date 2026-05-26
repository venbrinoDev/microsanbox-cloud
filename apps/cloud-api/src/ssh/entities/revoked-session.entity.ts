import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'revoked_sessions' })
export class RevokedSessionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  tokenHash!: string;

  @CreateDateColumn()
  revokedAt!: Date;
}
