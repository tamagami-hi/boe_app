import type { ColumnType, JSONColumnType } from "kysely"

export type Timestamp = ColumnType<Date, Date | string, Date | string>

export type TimestampDefault = ColumnType<Date, Date | string | undefined, Date | string>

export type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

export type Bytea = ColumnType<Buffer, Buffer | Uint8Array, Buffer | Uint8Array>

export type NullableBytea = ColumnType<
  Buffer | null,
  Buffer | Uint8Array | null | undefined,
  Buffer | Uint8Array | null
>

export type BigIntString = ColumnType<string, string | number | bigint, string | number | bigint>

export type BigIntStringDefault = ColumnType<
  string,
  string | number | bigint | undefined,
  string | number | bigint
>

export type NullableBigIntString = ColumnType<
  string | null,
  string | number | bigint | null | undefined,
  string | number | bigint | null
>

export type Numeric = ColumnType<string, string | number, string | number>

export type DateColumn = ColumnType<Date, Date | string, Date | string>

export type NullableDateColumn = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

export type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>

export type Json = JSONColumnType<Record<string, unknown>>

export type JsonDefault = ColumnType<Record<string, unknown>, string | undefined, string>
