import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'port_leases' })
@Unique(['runtimeHostId', 'port'])
export class PortLeaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  runtimeHostId!: string;

  @Column({ type: 'int' })
  port!: number;

  @Column({ type: 'varchar' })
  runtimeId!: string;

  @CreateDateColumn({ type: 'datetime' })
  leasedAt!: Date;
}
