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

export interface RuntimePortBindingRecord {
  name?: string;
  containerPort: number;
  hostPort: number;
  protocol: 'tcp' | 'udp';
}

export interface RuntimeVolumeMountRecord {
  volumeId: string;
  volumeName: string;
  mountPath: string;
  subpath?: string;
  readOnly?: boolean;
}

@Entity({ name: 'runtimes' })
@Unique(['sandboxId'])
@Unique(['name'])
export class RuntimeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  sandboxId!: string;

  @Column({ type: 'varchar', nullable: true })
  name!: string | null;

  @Column({ type: 'varchar' })
  sandboxName!: string;

  @Column({ type: 'varchar' })
  runtimeHostId!: string;

  @Column({ type: 'simple-json' })
  portBindings!: RuntimePortBindingRecord[];

  @Column({ type: 'int' })
  primaryPort!: number;

  @Column({ type: 'int' })
  hostPort!: number;

  @Column({ type: 'varchar', default: 'tcp' })
  primaryPortProtocol!: 'tcp' | 'udp';

  @Column({ type: 'boolean', default: false })
  public!: boolean;

  @Column({ type: 'varchar' })
  authToken!: string;

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

  @Column({ type: 'simple-json', nullable: true })
  mounts!: RuntimeVolumeMountRecord[] | null;

  @Column({ type: 'int', default: 1 })
  cpu!: number;

  @Column({ type: 'int', default: 2048 })
  memoryMiB!: number;

  @Column({ type: 'int', default: 6 })
  diskGiB!: number;

  @Column({ type: 'int', nullable: true })
  autoStopMinutes!: number | null;

  @Column({ type: 'boolean', default: false })
  ephemeral!: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastActiveAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  statusReason!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
