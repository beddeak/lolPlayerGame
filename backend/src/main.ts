import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './application.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApplication(app);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
