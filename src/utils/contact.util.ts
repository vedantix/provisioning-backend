export function normalizePostalCodeForCountry(
  countryCode: string,
  postalCode: string,
): string {
  const normalizedCountryCode = countryCode.trim().toUpperCase();
  const normalizedPostalCode = postalCode.trim().replace(/\s+/g, ' ');

  if (normalizedCountryCode === 'NL') {
    const compactPostalCode = normalizedPostalCode
      .replace(/\s+/g, '')
      .toUpperCase();
    const dutchPostalCode = /^(\d{4})([A-Z]{2})$/.exec(compactPostalCode);

    if (dutchPostalCode) {
      return `${dutchPostalCode[1]} ${dutchPostalCode[2]}`;
    }

    return normalizedPostalCode.toUpperCase();
  }

  return normalizedPostalCode;
}
