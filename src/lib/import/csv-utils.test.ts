import { describe, it, expect } from 'vitest'
import { detectDelimiter, parseCsvLine, parseMoney, splitCsvRecords } from './csv-utils'

describe('detectDelimiter', () => {
  it('picks ; for Spanish-locale Excel exports', () => {
    expect(detectDelimiter('Nombre;Teléfono;Valor')).toBe(';')
  })
  it('picks , by default and ignores separators inside quotes', () => {
    expect(detectDelimiter('name,phone')).toBe(',')
    expect(detectDelimiter('"a;b;c",phone')).toBe(',')
  })
  it('picks tab for TSV', () => {
    expect(detectDelimiter('name\tphone\tvalue')).toBe('\t')
  })
})

describe('parseCsvLine', () => {
  it('splits on the given delimiter', () => {
    expect(parseCsvLine('Ana;0987;1.234,50', ';')).toEqual(['Ana', '0987', '1.234,50'])
  })
  it('handles escaped quotes and keeps apostrophes', () => {
    expect(parseCsvLine('"Llantas ""El Rey""",O\'Brien')).toEqual(['Llantas "El Rey"', "O'Brien"])
  })
})

describe('splitCsvRecords', () => {
  it('keeps newlines inside quoted fields and drops a BOM', () => {
    expect(splitCsvRecords('﻿name,notes\r\nAna,"line 1\nline 2"\r\n\r\nLuis,x')).toEqual([
      'name,notes',
      'Ana,"line 1\nline 2"',
      'Luis,x',
    ])
  })
})

describe('parseMoney', () => {
  it('reads both decimal conventions', () => {
    expect(parseMoney('$1,234.50')).toBe(1234.5)
    expect(parseMoney('1.234,50')).toBe(1234.5)
    expect(parseMoney('1,5')).toBe(1.5)
    expect(parseMoney('1.5')).toBe(1.5)
  })
  it('treats a lone separator before 3 digits as thousands', () => {
    expect(parseMoney('1.234')).toBe(1234)
    expect(parseMoney('1,234')).toBe(1234)
    expect(parseMoney('1.234.567')).toBe(1234567)
  })
  it('returns NaN for non-numeric cells', () => {
    expect(parseMoney('')).toBeNaN()
    expect(parseMoney('n/a')).toBeNaN()
  })
})
