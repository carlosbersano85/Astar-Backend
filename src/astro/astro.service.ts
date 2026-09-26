import { Injectable } from '@nestjs/common';
import axios from 'axios';

type ImportantMomentCandidate = {
  key: string;
  natalPoint: string;
  transitPlanet: string;
  aspect: string;
  orbit: number;
  movement?: string;
  date: Date;
  house?: number;
};

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
  private readonly importantMomentsCache = new Map<
    string,
    { expiresAt: number; value: any }
  >();

  async getNatalChart(birthData: any) {
    const response = await axios.post(
      `${this.BASE}/api/v5/chart-data/birth-chart`,
      { subject: birthData },
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

  async getTransitChart(birthData: any, transitSubject: any) {
    const response = await axios.post(
      `${this.BASE}/api/v5/chart-data/transit`,
      {
        first_subject: birthData,
        transit_subject: transitSubject,
        include_house_comparison: true,
      },
      { headers: this.headers },
    );

    return response.data;
  }

  async getImportantMoments(birthData: any, requestedMonths = 12) {
    const months = [3, 6, 12].includes(requestedMonths)
      ? requestedMonths
      : 12;

    const today = new Date();
    const cachePeriod = `${today.getUTCFullYear()}-${String(
      today.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const cacheKey = [
      birthData?.year,
      birthData?.month,
      birthData?.day,
      birthData?.hour,
      birthData?.minute,
      birthData?.latitude,
      birthData?.longitude,
      birthData?.timezone,
      months,
      cachePeriod,
    ].join('|');

    const cached = this.importantMomentsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const start = new Date();
    start.setUTCHours(12, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + months);

    // A 14-day scan is deliberate: the portal is looking for the major,
    // slower cycles rather than every fast daily transit.
    const sampleDates: Date[] = [];
    for (
      let cursor = new Date(start);
      cursor <= end;
      cursor = this.addDays(cursor, 14)
    ) {
      sampleDates.push(new Date(cursor));
    }
    if (
      sampleDates.length === 0 ||
      sampleDates[sampleDates.length - 1].getTime() !== end.getTime()
    ) {
      sampleDates.push(new Date(end));
    }

    const snapshots: { date: Date; data: any }[] = [];

    // Keep a small amount of concurrency so the request stays responsive
    // without bursting the upstream API.
    for (let index = 0; index < sampleDates.length; index += 4) {
      const chunk = sampleDates.slice(index, index + 4);
      const results = await Promise.allSettled(
        chunk.map(async (date) => {
          const transitSubject = {
            name: 'Transit',
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour: 12,
            minute: 0,
            city: birthData?.city || undefined,
            longitude: birthData?.longitude,
            latitude: birthData?.latitude,
            timezone: birthData?.timezone,
          };

          const data = await this.getTransitChart(
            birthData,
            transitSubject,
          );

          return { date, data };
        }),
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          snapshots.push(result.value);
        }
      });
    }

    const grouped = new Map<string, ImportantMomentCandidate>();

    snapshots.forEach(({ date, data }) => {
      const chartData = data?.chart_data ?? data?.data?.chart_data ?? data;
      const aspects = Array.isArray(chartData?.aspects)
        ? chartData.aspects
        : [];

      const transitHouses = new Map<string, number>();
      const projected =
        chartData?.house_comparison?.second_points_in_first_houses;
      if (Array.isArray(projected)) {
        projected.forEach((point: any) => {
          const name = this.normalizeName(point?.point_name);
          const house = Number(point?.projected_house_number);
          if (name && Number.isFinite(house)) {
            transitHouses.set(name, house);
          }
        });
      }

      aspects.forEach((aspect: any) => {
        const transitPlanet = this.normalizeName(aspect?.p2_name);
        const natalPoint = this.normalizeName(aspect?.p1_name);
        const aspectName = this.normalizeName(aspect?.aspect);
        const orbit = Math.abs(Number(aspect?.orbit));

        if (!this.isImportantTransitPlanet(transitPlanet)) return;
        if (!this.isMajorAspect(aspectName)) return;
        if (!Number.isFinite(orbit) || orbit > 4.5) return;

        const p2Owner = this.normalizeName(aspect?.p2_owner);
        if (p2Owner && !p2Owner.includes('transit')) return;

        const key = `${transitPlanet}|${aspectName}|${natalPoint}`;
        const candidate: ImportantMomentCandidate = {
          key,
          natalPoint,
          transitPlanet,
          aspect: aspectName,
          orbit,
          movement:
            typeof aspect?.aspect_movement === 'string'
              ? aspect.aspect_movement
              : undefined,
          date,
          house: transitHouses.get(transitPlanet),
        };

        const previous = grouped.get(key);
        if (!previous || candidate.orbit < previous.orbit) {
          grouped.set(key, candidate);
        }
      });
    });

    const candidates = Array.from(grouped.values()).map((candidate) => ({
      candidate,
      intensity: this.scoreMoment(candidate),
    }));

    // Keep several meaningful moments in each three-month block, so the
    // near future never disappears behind stronger events later in the year.
    const buckets = new Map<number, typeof candidates>();
    candidates.forEach((item) => {
      const diffMonths =
        (item.candidate.date.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (item.candidate.date.getUTCMonth() - start.getUTCMonth());
      const bucket = Math.max(0, Math.floor(diffMonths / 3));
      const list = buckets.get(bucket) ?? [];
      list.push(item);
      buckets.set(bucket, list);
    });

    const selected = Array.from(buckets.values())
      .flatMap((bucket) =>
        bucket
          .sort(
            (a, b) =>
              b.intensity - a.intensity ||
              a.candidate.orbit - b.candidate.orbit,
          )
          .slice(0, 5),
      )
      .sort(
        (a, b) =>
          a.candidate.date.getTime() - b.candidate.date.getTime(),
      );

    const moments = selected.map(({ candidate, intensity }, index) =>
      this.toImportantMoment(candidate, intensity, index),
    );

    const value = {
      months,
      generatedAt: new Date().toISOString(),
      scan: {
        from: this.toDateString(start),
        to: this.toDateString(end),
        intervalDays: 14,
        snapshotsRequested: sampleDates.length,
        snapshotsReceived: snapshots.length,
        scope:
          'Major transits from Jupiter, Saturn, Uranus, Neptune and Pluto (plus Chiron and lunar nodes when returned by the provider).',
      },
      moments,
    };

    // The time window shifts slowly. A monthly cache keeps API usage
    // predictable while still refreshing the forecast regularly.
    this.importantMomentsCache.set(cacheKey, {
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      value,
    });

    return value;
  }

  private toImportantMoment(
    candidate: ImportantMomentCandidate,
    intensity: number,
    index: number,
  ) {
    const transitLabel = this.pointLabel(candidate.transitPlanet);
    const natalLabel = this.pointLabel(candidate.natalPoint);
    const aspectLabel = this.aspectLabel(candidate.aspect);
    const theme = this.themeForMoment(candidate);
    const rangeDays = this.rangeDaysForTransit(candidate.transitPlanet);
    const startDate = this.addDays(candidate.date, -rangeDays);
    const endDate = this.addDays(candidate.date, rangeDays);

    return {
      id: `important-moment-${index + 1}`,
      title: `${transitLabel} ${aspectLabel} ${natalLabel}`,
      theme,
      startDate: this.toDateString(startDate),
      endDate: this.toDateString(endDate),
      peakDate: this.toDateString(candidate.date),
      intensity,
      summary: `${transitLabel} activa tu ${natalLabel} mediante ${aspectLabel}. Este período pone el foco en ${theme.toLowerCase()} y puede sentirse como ${this.transitMeaning(
        candidate.transitPlanet,
      )}. La propuesta es observar qué está pidiendo este proceso y darle una respuesta cada vez más consciente.`,
      details: `Base técnica: ${transitLabel} en tránsito · ${aspectLabel} · ${natalLabel} natal · orbe aproximado ${candidate.orbit.toFixed(
        1,
      )}°${candidate.house ? ` · transita Casa ${candidate.house}` : ''}${
        candidate.movement ? ` · ${candidate.movement}` : ''
      }.`,
      focus: `${transitLabel} ${aspectLabel} ${natalLabel}${
        candidate.house ? ` Casa ${candidate.house}` : ''
      }`,
      technical: {
        transitPlanet,
        natalPoint: candidate.natalPoint,
        aspect: candidate.aspect,
        orbit: candidate.orbit,
        movement: candidate.movement ?? null,
        natalHouse: candidate.house ?? null,
      },
    };
  }

  private scoreMoment(candidate: ImportantMomentCandidate) {
    const transitWeights: Record<string, number> = {
      jupiter: 4.5,
      saturn: 6,
      uranus: 6.5,
      neptune: 6,
      pluto: 7,
      chiron: 4.5,
      true_north_lunar_node: 5,
      mean_north_lunar_node: 5,
      north_node: 5,
    };

    const aspectWeights: Record<string, number> = {
      conjunction: 2,
      opposition: 2,
      square: 2,
      trine: 1.2,
      sextile: 0.8,
    };

    const natalWeights: Record<string, number> = {
      sun: 1.5,
      moon: 1.7,
      ascendant: 1.7,
      medium_coeli: 1.4,
      venus: 1.2,
      mars: 1.1,
      mercury: 0.8,
      jupiter: 0.8,
      saturn: 1,
    };

    const raw =
      (transitWeights[candidate.transitPlanet] ?? 4) +
      (aspectWeights[candidate.aspect] ?? 0.5) +
      (natalWeights[candidate.natalPoint] ?? 0.5) -
      candidate.orbit * 0.65;

    return Math.max(5, Math.min(10, Math.round(raw)));
  }

  private themeForMoment(candidate: ImportantMomentCandidate) {
    const houseThemes: Record<number, string> = {
      1: 'Identidad y forma de avanzar',
      2: 'Dinero, recursos y valor personal',
      3: 'Comunicación, ideas y aprendizaje',
      4: 'Hogar, familia y bases emocionales',
      5: 'Creatividad, deseo y expresión personal',
      6: 'Rutinas, trabajo cotidiano y bienestar',
      7: 'Vínculos y acuerdos',
      8: 'Intimidad, confianza y transformación',
      9: 'Sentido, creencias y expansión',
      10: 'Profesión, dirección y visibilidad',
      11: 'Proyectos, comunidad y futuro',
      12: 'Mundo interno, cierres y elaboración',
    };

    if (candidate.house && houseThemes[candidate.house]) {
      return houseThemes[candidate.house];
    }

    const pointThemes: Record<string, string> = {
      sun: 'Identidad y dirección personal',
      moon: 'Emociones, seguridad y pertenencia',
      mercury: 'Pensamiento y comunicación',
      venus: 'Vínculos, deseo y valores',
      mars: 'Acción, deseo y límites',
      jupiter: 'Expansión, oportunidades y sentido',
      saturn: 'Responsabilidad, estructura y maduración',
      ascendant: 'Identidad y manera de abrir camino',
      medium_coeli: 'Profesión y dirección pública',
    };

    return pointThemes[candidate.natalPoint] ?? 'Cambio y desarrollo personal';
  }

  private transitMeaning(planet: string) {
    const meanings: Record<string, string> = {
      jupiter: 'una apertura que amplía posibilidades, confianza o perspectiva',
      saturn: 'una necesidad de ordenar, asumir responsabilidades y dar estructura',
      uranus: 'una búsqueda de libertad, cambio y nuevas formas de hacer las cosas',
      neptune: 'una etapa de sensibilidad, inspiración y redefinición de límites',
      pluto: 'un proceso profundo de transformación, depuración y renovación',
      chiron: 'una sensibilidad que puede convertirse en comprensión y aprendizaje',
      true_north_lunar_node:
        'un movimiento que orienta hacia nuevas experiencias y aprendizajes',
      mean_north_lunar_node:
        'un movimiento que orienta hacia nuevas experiencias y aprendizajes',
      north_node:
        'un movimiento que orienta hacia nuevas experiencias y aprendizajes',
    };

    return meanings[planet] ?? 'un período de movimiento y reorganización';
  }

  private pointLabel(point: string) {
    const labels: Record<string, string> = {
      sun: 'Sol',
      moon: 'Luna',
      mercury: 'Mercurio',
      venus: 'Venus',
      mars: 'Marte',
      jupiter: 'Júpiter',
      saturn: 'Saturno',
      uranus: 'Urano',
      neptune: 'Neptuno',
      pluto: 'Plutón',
      chiron: 'Quirón',
      ascendant: 'Ascendente',
      medium_coeli: 'Medio Cielo',
      true_north_lunar_node: 'Nodo Norte',
      mean_north_lunar_node: 'Nodo Norte',
      north_node: 'Nodo Norte',
    };

    return labels[point] ?? point.replace(/_/g, ' ');
  }

  private aspectLabel(aspect: string) {
    const labels: Record<string, string> = {
      conjunction: 'conjunción',
      opposition: 'oposición',
      square: 'cuadratura',
      trine: 'trígono',
      sextile: 'sextil',
    };
    return labels[aspect] ?? aspect;
  }

  private rangeDaysForTransit(planet: string) {
    const ranges: Record<string, number> = {
      jupiter: 14,
      saturn: 24,
      uranus: 35,
      neptune: 40,
      pluto: 45,
      chiron: 21,
      true_north_lunar_node: 18,
      mean_north_lunar_node: 18,
      north_node: 18,
    };
    return ranges[planet] ?? 14;
  }

  private isImportantTransitPlanet(planet: string) {
    return [
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'pluto',
      'chiron',
      'true_north_lunar_node',
      'mean_north_lunar_node',
      'north_node',
    ].includes(planet);
  }

  private isMajorAspect(aspect: string) {
    return [
      'conjunction',
      'opposition',
      'square',
      'trine',
      'sextile',
    ].includes(aspect);
  }

  private normalizeName(value: unknown) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  private addDays(date: Date, days: number) {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  }

  private toDateString(date: Date) {
    return date.toISOString().slice(0, 10);
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
