import {
  IsBoolean,
  IsEmail,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;

  @IsString()
  birthDate!: string;

  @IsString()
  birthPlace!: string;

  @IsOptional()
  @IsLatitude()
  birthLatitude?: string;

  @IsOptional()
  @IsLongitude()
  birthLongitude?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  birthTimezone?: string;

  @IsOptional()
  @IsBoolean()
  birthTimeKnown?: boolean;

  @ValidateIf((dto: RegisterDto) => dto.birthTimeKnown !== false)
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'birthTime must use HH:mm format',
  })
  birthTime?: string;
}
