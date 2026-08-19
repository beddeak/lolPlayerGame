import {IsEnum,IsNotEmpty,IsString,Length} from 'class-validator';
import { Position } from '../eunms/player-eunms.eunm';

export class CreatePlayerDto {
    @IsString()
    @IsNotEmpty()
    @Length(2, 20)
    name!: string;

    @IsEnum(Position)
    @IsNotEmpty()
    position!: Position;
}