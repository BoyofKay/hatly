/** Egyptian national input, with support for pasted international and Arabic numerals. */
function ascii(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660));
}
export function egyptNationalNumber(value: string): string {
  let digits = ascii(value).trim().replace(/[^0-9+]/g, '');
  if (digits.startsWith('+20')) digits = digits.slice(3);
  else if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2);
  return digits;
}
export function egyptPhoneForAuth(value: string): string | null {
  const digits = egyptNationalNumber(value).replace(/^0/, '');
  return /^1[0125][0-9]{8}$/.test(digits) ? '+20' + digits : null;
}
