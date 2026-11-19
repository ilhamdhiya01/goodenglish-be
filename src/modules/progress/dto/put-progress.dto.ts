import { IsDefined, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

// `data` is the exact JSON value the frontend store holds for this key
// (a map, an array, a string…). Its shape is owned by the frontend store, so
// it's only required to be present here, not validated field by field.
export class PutProgressDto {
  @IsDefined()
  data!: unknown;

  // Version (ms) of the document the client last saw: the save only lands if
  // the server still holds that version, otherwise 409 progress_conflict and
  // the client merges. null = "I saw no document". Omitted = overwrite, as
  // older clients do.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  baseVersion?: number | null;
}
