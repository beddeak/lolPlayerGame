import { Test, TestingModule } from '@nestjs/testing';
import { CatalogAdminGuard } from '../auth/catalog-admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

describe('PlayersController', () => {
  let controller: PlayersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlayersController],
      providers: [
        {
          provide: PlayersService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    })
      // This unit test isolates the controller; real authorization is covered
      // by guard tests and the full HTTP/MySQL e2e flow.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CatalogAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PlayersController>(PlayersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
