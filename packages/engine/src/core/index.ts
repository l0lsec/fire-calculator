export * from "./rates";
export * from "./schema";
export * from "./time";

/** Round to cents for display and fixtures; the engine itself never rounds. */
export function cents(x: number): number {
  return Math.round(x * 100) / 100;
}
