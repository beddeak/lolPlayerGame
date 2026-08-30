import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { FeedbackOption } from '../enums/feedback-option.enum';
import { FeedbackType } from '../enums/feedback-type.enum';

export class CreateFeedbackDto {
  @IsEnum(FeedbackType)
  type!: FeedbackType;

  @IsEnum(FeedbackOption)
  option!: FeedbackOption;

  @IsOptional()
  @IsInt()
  @IsPositive()
  careerPlayerId?: number;
}
