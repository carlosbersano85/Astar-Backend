import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireSubscriptionGuard } from '../guards/require-subscription.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AstroService } from './astro.service';
import { UsersService } from '../users/users.service';

@Controller('astro')
export class AstroController {
  constructor(
    private readonly astroService: AstroService,
    private readonly usersService: UsersService,
  ) {}

  @Get('demo-natal-chart')
  async demoNatalChart() {
    const data = await this.astroService.getDemoNatalChart();
    return { success: true, data };
  }

  @Post('natal-chart')
  @UseGuards(JwtAuthGuard)
  async natalChart(@CurrentUser() user: { id: string }, @Body() body: any) {
    const data = await this.astroService.getNatalChart(body);
    return { success: true, data, userId: user.id };
  }

  @Post('solar-return')
  @UseGuards(JwtAuthGuard, RequireSubscriptionGuard)
  async solarReturn(@CurrentUser() user: { id: string }, @Body() body: any) {
    const { returnYear, ...birthData } = body;

    const data = await this.astroService.getSolarReturn(
      birthData,
      Number(returnYear || new Date().getFullYear()),
    );

    return { success: true, data, userId: user.id };
  }

  @Post('synastry')
  @UseGuards(JwtAuthGuard, RequireSubscriptionGuard)
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async getUserNatalChart(@CurrentUser() user: { id: string }) {
    const dbUser = await this.usersService.findById(user.id);
    if (!dbUser || !dbUser.birthDate) {
      throw new ForbiddenException('Birth date not found in profile');
    }

    if (
      dbUser.birthLatitude == null ||
      dbUser.birthLongitude == null ||
      !dbUser.birthTimezone
    ) {
      throw new BadRequestException(
        'Birth coordinates and timezone are required to calculate the natal chart',
      );
    }

    if (!dbUser.birthTimeKnown || !dbUser.birthTime) {
      return {
        success: true,
        limited: true,
        data: null,
        message:
          'La hora exacta permite calcular el Ascendente y las casas. Tu perfil conservará una lectura limitada.',
        userId: user.id,
      };
    }

    const [year, month, day] = dbUser.birthDate.split('-').map(Number);
    const [hour, minute] = dbUser.birthTime.split(':').map(Number);

    const birthData = {
      name: dbUser.name,
      year,
      month,
      day,
      hour,
      minute,
      second: 0,
      city: dbUser.birthPlace || undefined,
      latitude: dbUser.birthLatitude,
      longitude: dbUser.birthLongitude,
      timezone: dbUser.birthTimezone,
      zodiac_type: 'Tropical',
      perspective_type: 'Apparent Geocentric',
      houses_system_identifier: 'P',
    };

    const data = await this.astroService.getNatalChart(birthData);
    return { success: true, limited: false, data, userId: user.id };
  }

  @Get('numerology/user')
  @UseGuards(JwtAuthGuard)
  async getUserNumerology(@CurrentUser() user: { id: string }) {
    const dbUser = await this.usersService.findById(user.id);
    if (!dbUser || !dbUser.birthDate) {
      throw new ForbiddenException('Birth date not found in profile');
    }

    const data = this.astroService.getNumerology(dbUser.birthDate, dbUser.name);
    return { success: true, data };
  }
}
