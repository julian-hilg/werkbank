/** Number formatting shared by the tools. */
const money0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const price = (n: number) => money2.format(n);
export const whole = (n: number) => money0.format(n);
/** Signed amount, e.g. +1,234 or −567. The sign carries the meaning as well as the colour. */
export const signed = (n: number, digits = 0) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${(digits ? money2 : money0).format(Math.abs(n))}`;
export const pct = (ratio: number) => `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(ratio * 100).toFixed(2)}%`;
export const tone = (n: number) => (n > 0 ? "wb-up" : n < 0 ? "wb-down" : undefined);
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
export const compact = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
