import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'ssh_sessions' })
export class SshSessionEntity {
  @PrimaryColumn({ type: 'varchar' })
  token!: string;

  @Column({ type: 'varchar' })
  sandboxId!: string;

  @Column({ type: 'int' })
  hostPort!: number;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'boolean', default: false })
  revoked!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
