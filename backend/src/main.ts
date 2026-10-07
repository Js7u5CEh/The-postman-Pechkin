import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Точка входа. Глобальный ValidationPipe для DTO (class-validator).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  // CORS для локального фронтенда (Vite default :5173)
  app.enableCors({ origin: ['http://localhost:5173'] });
  await app.listen(3000);
  console.log('Backend запущен: http://localhost:3000');
}

void bootstrap();
