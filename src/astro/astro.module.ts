import { Module } from '@nestjs/common';
import { AstroController } from './astro.controller';
import { AstroService } from './astro.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [AstroController],
  providers: [AstroService],
})
export class AstroModule {}