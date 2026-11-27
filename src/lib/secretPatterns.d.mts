export interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
}

export interface SecretFinding {
  id: string;
  label: string;
  index: number;
  length: number;
  value: string;
  preview: string;
}

export declare const SECRET_PATTERNS: readonly SecretPattern[];
export declare const PUBLIC_VALUE_PATTERNS: Readonly<Record<string, RegExp>>;

export declare function toText(input: unknown): string;
export declare function maskSecret(value: string): string;
export declare function findSecrets(input: unknown): SecretFinding[];
export declare function redactSecrets(input: unknown): string;
export declare function redactValue<T>(value: T, seen?: WeakSet<object>, depth?: number): T;
export declare function hasSecrets(input: unknown): boolean;
export declare function isCanary(input: unknown): boolean;
