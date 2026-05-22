import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'signed_preview_tokens' })
@Unique(['token', 'port'])
export class SignedPreviewTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  token!: string;

  @Column({ type: 'varchar' })
  sandboxId!: string;

  @Column({ type: 'int' })
  port!: number;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
