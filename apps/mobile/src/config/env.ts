declare const __OPEN_METEO_API_KEY__: string | undefined;

export const openMeteoApiKey = typeof __OPEN_METEO_API_KEY__ === 'string'
  ? __OPEN_METEO_API_KEY__
  : '';
