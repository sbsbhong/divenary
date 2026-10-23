import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * The Divenary logo mark, copied from docs/superpowers/specs/2026-10-23-watch-plumb-redesign/LOGO.md.
 * This is the only manta the app draws. Do not redraw it by hand. It is monochrome: the caller
 * passes the colour, and the even-odd fill keeps the eye hole open.
 */
export const LOGO_MARK_VIEW_BOX = '9 19 81 64';
export const LOGO_MARK_ASPECT_RATIO = 81 / 64;
export const LOGO_MARK_PATH =
  'M75.2 82.0L75.9 81.3L75.9 80.8L75.6 80.5L70.4 78.3L67.7 77.0L65.3 75.2L63.4 73.1L62.1 71.1L61.1 68.5L60.9 66.0L61.2 63.4L62.1 61.5L62.9 60.4L68.5 56.7L72.9 53.2L76.3 49.9L80.2 45.0L84.6 38.1L86.7 34.0L88.5 28.8L88.9 26.1L88.9 23.9L88.5 23.6L88.0 23.6L85.8 26.1L83.7 27.9L81.8 29.2L78.2 30.9L72.3 32.3L69.6 32.6L66.3 32.6L61.0 31.8L57.9 30.9L54.9 29.6L52.2 27.9L50.0 26.1L46.6 21.7L45.5 20.5L44.2 19.8L42.5 19.7L41.8 20.1L41.3 20.8L41.4 24.4L40.5 26.1L39.2 27.1L34.6 29.3L31.3 31.2L29.8 31.4L28.6 30.9L27.8 29.7L27.2 27.7L26.6 27.1L25.6 27.0L24.9 27.6L24.3 29.0L24.1 30.7L24.3 33.2L25.2 37.1L25.1 39.4L24.7 40.9L23.9 42.5L22.6 44.2L15.9 50.2L13.6 52.7L12.0 55.0L10.7 57.6L10.1 59.5L9.8 62.2L10.0 64.2L10.9 64.3L13.0 63.4L15.7 62.6L20.0 62.0L26.1 62.1L32.7 63.4L37.1 64.7L44.2 67.8L60.8 76.3L66.6 79.0L70.8 80.7L75.0 82.0ZM45.5 29.9L44.4 29.7L43.7 28.8L43.8 27.7L45.0 26.8L46.0 27.0L46.5 27.4L46.8 28.1L46.6 29.2L45.6 29.9Z';

export function LogoMark(props: { width: number; color: string; testID?: string }): React.JSX.Element {
  return (
    <Svg
      testID={props.testID}
      width={props.width}
      height={props.width / LOGO_MARK_ASPECT_RATIO}
      viewBox={LOGO_MARK_VIEW_BOX}>
      <Path fill={props.color} fillRule="evenodd" d={LOGO_MARK_PATH} />
    </Svg>
  );
}
