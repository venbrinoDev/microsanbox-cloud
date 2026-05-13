import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type RuntimeStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'draining'
  | 'deleting'
  | 'deleted'
  | 'error';

export interface RuntimeSecretRecord {
  env: string;
  value: string;
  placeholder?: string;
  allowedHosts: string[];
  allowedHostPatterns: string[];
  allowAnyHostDangerous?: boolean;
  requireTlsIdentity?: boolean;
  injectHeaders?: boolean;
  injectBasicAuth?: boolean;
  injectQuery?: boolean;
  injectBody?: boolean;
}

@Entity({ name: 'runtimes' })
@Unique(['sandboxId'])
export class RuntimeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  sandboxId!: string;

  @Column({ type: 'varchar' })
  sandboxName!: string;

  @Column({ type: 'varchar', nullable: true })
  volumeName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  volumeMountPath!: string | null;

  @Column({ type: 'varchar' })
  runtimeHostId!: string;

  @Column({ type: 'int' })
  hostPort!: number;

  @Column({ type: 'int' })
  primaryPort!: number;

  @Column({ type: 'varchar' })
  status!: RuntimeStatus;

  @Column({ type: 'varchar' })
  image!: string;

  @Column({ type: 'simple-json', nullable: true })
  command!: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  environment!: Record<string, string> | null;

  @Column({ type: 'simple-json', nullable: true })
  secrets!: RuntimeSecretRecord[] | null;

  @Column({ type: 'varchar', nullable: true })
  workingDir!: string | null;

  @Column({ type: 'varchar', default: 'tcp' })
  primaryPortProtocol!: 'tcp' | 'udp';

  @Column({ type: 'datetime', nullable: true })
  lastActiveAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  statusReason!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
