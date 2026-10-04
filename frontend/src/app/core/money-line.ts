/** Soma e produto de decimais escritos em string. Não usa Number: o piso oficial não pode depender de binário. */

function parts(value: string): { sign: 1 | -1; digits: bigint; scale: number } | null {
  const raw = value.trim().replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const body = raw.replace(/^[+-]/, "");
  const [whole, fraction = ""] = body.split(".");
  const digits = BigInt(whole + fraction || "0");
  return { sign: negative ? -1 : 1, digits, scale: fraction.length };
}

function format(sign: 1 | -1, digits: bigint, scale: number): string {
  if (digits === 0n) return "0";
  const text = digits.toString().padStart(scale + 1, "0");
  const cut = text.length - scale;
  const fraction = text.slice(cut).replace(/0+$/, "");
  const prefix = sign < 0 ? "-" : "";
  return fraction ? `${prefix}${text.slice(0, cut)}.${fraction}` : `${prefix}${text.slice(0, cut)}`;
}

export function sumDecimals(values: readonly string[]): string | null {
  if (!values.length) return "0";
  const parsed = [];
  let scale = 0;
  for (const value of values) {
    const part = parts(value);
    if (!part) return null;
    parsed.push(part);
    scale = Math.max(scale, part.scale);
  }
  let total = 0n;
  for (const part of parsed) total += BigInt(part.sign) * part.digits * 10n ** BigInt(scale - part.scale);
  const negative = total < 0n;
  return format(negative ? -1 : 1, negative ? -total : total, scale);
}

export function multiplyDecimals(left: string, right: string): string | null {
  const a = parts(left);
  const b = parts(right);
  if (!a || !b) return null;
  return format(a.sign * b.sign < 0 ? -1 : 1, a.digits * b.digits, a.scale + b.scale);
}

export function lineQuantity(unloading: string, removal: string, transfer: string): string | null {
  return sumDecimals([unloading, removal, transfer]);
}

export function lineAmount(quantity: string | null, price: string): string | null {
  if (quantity === null || !price.trim() || price === "—" || price === "Não disponível") return null;
  return multiplyDecimals(quantity, price);
}

export function isHalfDay(fraction: string): boolean {
  return sumDecimals([fraction]) === "0.5";
}
