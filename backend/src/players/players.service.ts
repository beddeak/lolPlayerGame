import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePlayerDto } from './dto/create-player.dto';
import { Player } from './entities/player.entity';

@Injectable()
export class PlayersService {
  constructor(
    @InjectRepository(Player)
    private readonly playersRepository: Repository<Player>,
  ) {}

  async create(dto: CreatePlayerDto): Promise<Player> {
    const player = this.playersRepository.create(dto);

    return this.playersRepository.save(player);
  }

  findAll(): Promise<Player[]> {
    return this.playersRepository.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<Player> {
    const player = await this.playersRepository.findOneBy({ id });

    if (!player) {
      throw new NotFoundException(`Player ${id} was not found`);
    }

    return player;
  }
}
