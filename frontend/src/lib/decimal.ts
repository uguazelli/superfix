export const decimalInputPattern = '-?[0-9]{1,9}([.,][0-9]{1,6})?'

export function canonicalDecimal(value: string): string {
  return value.replace(',', '.')
}

export function localizedDecimal(value: string | null | undefined, locale: string): string {
  if (value == null) return ''
  return locale.toLowerCase().startsWith('en') ? value : value.replace('.', ',')
}
