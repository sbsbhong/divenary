import { formatDepth, formatLength, formatTemperature } from '../src/utils/dive-formatters';

describe('dive formatters', () => {
  it('rounds display values to one decimal, like the log formatters', () => {
    expect(formatDepth(0.29392323)).toBe('0.3 m');
    expect(formatDepth(18.95)).toBe('19.0 m');
    expect(formatLength(25.125)).toBe('25.1 m');
    expect(formatTemperature(21.26)).toBe('21.3 °C');
  });

  it('shows an unknown value as -- with its unit, never 0', () => {
    expect(formatDepth(undefined)).toBe('-- m');
    expect(formatLength(undefined)).toBe('-- m');
    expect(formatTemperature(undefined)).toBe('-- °C');
  });
});
