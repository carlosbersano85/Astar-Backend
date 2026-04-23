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

  async getNatalChart(birthData: any) {
    const response = await axios.post(
      `${this.BASE}/api/v5/chart-data/birth-chart`,
      { subject: birthData },
      { headers: this.headers },
    );
    return response.data;
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