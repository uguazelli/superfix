export type DeepStringify<T> = T extends string
  ? string
  : T extends object
    ? { [K in keyof T]: DeepStringify<T[K]> }
    : T
