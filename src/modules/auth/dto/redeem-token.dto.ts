import { IsString, MaxLength, MinLength } from 'class-validator';

export class RedeemTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}
