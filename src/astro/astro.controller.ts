import { Controller, Post, Get, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireSubscriptionGuard } from '../guards/require-subscription.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AstroService } from './astro.service';
import { UsersService } from '../users/users.service';

@Controller('astro')
@UseGuards(JwtAuthGuard, RequireSubscriptionGuard)
export class AstroController {
  constructor(
    private readonly astroService: AstroService,
    private readonly usersService: UsersService,
  ) {}

  @Post('natal-chart')
  async natalChart(@CurrentUser() user: { id: string }, @Body() body: any) {
    const data = await this.astroService.getNatalChart(body);
    return { success: true, data, userId: user.id };
  }

  @Post('solar-return')
  async solarReturn(@CurrentUser() user: { id: string }, @Body() body: any) {
    const { returnYear, ...birthData } = body;

    const data = await this.astroService.getSolarReturn(
      birthData,
      Number(returnYear || new Date().getFullYear()),
    );

    return { success: true, data, userId: user.id };
  }

  @Post('synastry')
  async synastry(@CurrentUser() user: { id: string }, @Body() body: any) {
    const { person1, person2 } = body;

    if (!person1 || !person2) {
      return {
        success: false,
        error: 'person1 and person2 are required',
      };
    }

    const data = await this.astroService.getSynastry(person1, person2);
    return { success: true, data, userId: user.id };
  }

  @Post('numerology')
  numerology(@Body() body: any) {
    const { birthDate, fullName } = body;

    if (!birthDate) {
      return {
        success: false,
        error: 'birthDate is required',
      };
    }

    const data = this.astroService.getNumerology(
      birthDate,
      fullName || 'User',
    );

    return { success: true, data };
  }

  @Get('natal-chart/user')
  async getUserNatalChart(@CurrentUser() user: { id: string }) {
    const dbUser = await this.usersService.findById(user.id);
    if (!dbUser || !dbUser.birthDate) {
      throw new ForbiddenException('Birth date not found in profile');
    }

    const birthData = {
      year: parseInt(dbUser.birthDate.split('-')[0]),
      month: parseInt(dbUser.birthDate.split('-')[1]),
      day: parseInt(dbUser.birthDate.split('-')[2]),
      hour: dbUser.birthTime ? parseInt(dbUser.birthTime.split(':')[0]) : 12,
      minute: dbUser.birthTime ? parseInt(dbUser.birthTime.split(':')[1]) : 0,
      latitude: 0,
      longitude: 0,
      timezone: 0,
    };

    const data = await this.astroService.getNatalChart(birthData);
    return { success: true, data, userId: user.id };
  }

  @Get('numerology/user')
  async getUserNumerology(@CurrentUser() user: { id: string }) {
    const dbUser = await this.usersService.findById(user.id);
    if (!dbUser || !dbUser.birthDate) {
      throw new ForbiddenException('Birth date not found in profile');
    }

    const data = this.astroService.getNumerology(dbUser.birthDate, dbUser.name);
    return { success: true, data };
  }
}