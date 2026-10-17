/**
 * Counts in sentences, shared by the engine's explanations and the screens, so "1 rooms" or
 * "1 open quote that are" cannot appear anywhere.
 */

/** The singular word for exactly one, the plural otherwise: plural(n, 'is', 'are'). */
export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** A count with its noun: counted(1, 'room') is "1 room", counted(2, 'room') "2 rooms". */
export function counted(count: number, one: string, many = `${one}s`): string {
  return `${count} ${plural(count, one, many)}`;
}
