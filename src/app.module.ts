import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { PortalModule } from './portal/portal.module';
import { BirthChartModule } from './birth-chart/birth-chart.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, AdminModule, PortalModule, BirthChartModule, PaymentsModule],
})
export class AppModule {}
