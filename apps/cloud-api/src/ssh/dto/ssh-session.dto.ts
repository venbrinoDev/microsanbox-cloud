import { ApiProperty } from '@nestjs/swagger';

export class CreateSshSessionDto {
  @ApiProperty({ description: 'Ephemeral SSH session token' })
  token!: string;

  @ApiProperty({ description: 'ISO expiration timestamp' })
  expiresAt!: string;

  @ApiProperty({ description: 'SSH command to connect' })
  sshCommand!: string;
}

export class SshValidateResponseDto {
  @ApiProperty({ description: 'Sandbox ID' })
  sandboxId!: string;

  @ApiProperty({ description: 'Host port for the SSH connection' })
  hostPort!: number;
}
