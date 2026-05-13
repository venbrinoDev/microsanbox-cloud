import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'runtime_hosts' })
export class RuntimeHostEntity {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  baseUrl!: string;

  @Column({ type: 'varchar' })
  publicBaseUrl!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt!: Date | null;
}
