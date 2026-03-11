import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const express = require('express') as typeof import('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cors = require('cors') as typeof import('cors');

async function bootstrap() {
  const expressApp = express();

  // 1. Body parser first (large payloads for image uploads, etc.)
  expressApp.use(express.json({ limit: '50mb' }));
  expressApp.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 2. CORS – allow any origin so preflight always gets Access-Control-Allow-Origin (reflect request origin)
  const corsOptions: import('cors').CorsOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };

  expressApp.use(cors(corsOptions));

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bodyParser: false,
    rawBody: false,
  });

  // Global validation pipe (whitelist strips unknown props; forbidNonWhitelisted: false avoids 400 on extra fields)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const port = process.env.PORT != null ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);

  console.log(`Backend running at http://localhost:${port}`);
  console.log('CORS: origin=true (reflect request origin)');
}
bootstrap();
