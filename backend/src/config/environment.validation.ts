import {
  plainToInstance,
  Transform,
  TransformFnParams,
  Type,
} from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const MIN_PORT = 1;
const MAX_PORT = 65_535;

function normalizeBooleanString(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_PORT)
  @Max(MAX_PORT)
  DB_PORT!: number;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DB_DATABASE!: string;

  @Transform(({ value }: TransformFnParams) =>
    normalizeBooleanString(value as unknown),
  )
  @IsIn(['true', 'false'])
  DB_SSL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  JWT_EXPIRES_IN_SECONDS!: number;

  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string'
      ? value.trim() === ''
        ? []
        : value
            .split(',')
            .map((id) =>
              /^[1-9]\d*$/.test(id.trim()) ? Number(id.trim()) : Number.NaN,
            )
      : (value as unknown),
  )
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(4_294_967_295, { each: true })
  CATALOG_ADMIN_ACCOUNT_IDS: number[] = [];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PORT)
  @Max(MAX_PORT)
  PORT?: number;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    validationError: {
      target: false,
      value: false,
    },
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

    throw new Error(
      `Invalid environment configuration: ${messages.join(', ')}`,
    );
  }

  return validatedConfig;
}
