import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class AstroService {
  private readonly RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
  private readonly RAPIDAPI_HOST =
    process.env.RAPIDAPI_HOST || 'astrologer.p.rapidapi.com';

  private readonly headers = {
    'x-rapidapi-key': this.RAPIDAPI_KEY,
    'x-rapidapi-host': this.RAPIDAPI_HOST,
    'Content-Type': 'application/json',
  };

  private readonly BASE = `https://${this.RAPIDAPI_HOST}`;
  private demoNatalChartCache: unknown | null = null;

  async getNatalChart(birthData: any) {
    const chartTitle = `${birthData.name || 'Carta natal'} · Carta natal`.slice(0, 40);
    const response = await axios.post(
      `${this.BASE}/api/v5/chart/birth-chart`,
      {
        subject: birthData,
        theme: 'dark',
        language: 'ES',
        style: 'modern',
        show_zodiac_background_ring: true,
        transparent_background: true,
        show_degree_indicators: true,
        show_aspect_icons: true,
        custom_title: chartTitle,
      },
      { headers: this.headers },
    );
    return response.data;
  }

  async getDemoNatalChart() {
    if (this.demoNatalChartCache) {
      return this.demoNatalChartCache;
    }

    this.demoNatalChartCache = await this.getNatalChart({
      name: 'Laura',
      year: 1988,
      month: 7,
      day: 12,
      hour: 14,
      minute: 30,
      second: 0,
      city: 'Cordoba',
      nation: 'AR',
      timezone: 'America/Argentina/Cordoba',
      longitude: -64.1888,
      latitude: -31.4201,
      zodiac_type: 'Tropical',
      perspective_type: 'Apparent Geocentric',
      houses_system_identifier: 'P',
    });

    return this.demoNatalChartCache;
  }

  async getSolarReturn(birthData: any, returnYear: number) {
    const response = await axios.post(
      `${this.BASE}/api/v5/chart-data/solar-return`,
      { subject: birthData, year: returnYear },
      { headers: this.headers },
    );
    return response.data;
  }

  async getSynastry(person1: any, person2: any) {
    const response = await axios.post(
      `${this.BASE}/api/v5/chart-data/synastry`,
      { first_subject: person1, second_subject: person2 },
      { headers: this.headers },
    );
    return response.data;
  }

  getNumerology(birthDate: string, fullName: string) {
    const digits = birthDate.replace(/-/g, '').split('').map(Number);

    let sum = digits.reduce((a, b) => a + b, 0);

    while (sum > 9 && sum !== 11 && sum !== 22 && sum !== 33) {
      sum = String(sum)
        .split('')
        .map(Number)
        .reduce((a, b) => a + b, 0);
    }

    return {
      lifePathNumber: sum,
      name: fullName,
      birthDate,
    };
  }
}
