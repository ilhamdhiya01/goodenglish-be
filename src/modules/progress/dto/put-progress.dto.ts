import { IsDefined } from 'class-validator';

// `data` is the exact JSON value the frontend store holds for this key
// (a map, an array, a string…). Its shape is owned by the frontend store, so
// it's only required to be present here, not validated field by field.
export class PutProgressDto {
  @IsDefined()
  data!: unknown;
}
