import React, { useCallback, useId, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ClipPath, Defs, Path, Rect, Svg } from 'react-native-svg';
import { LOGO_MARK_ASPECT_RATIO, LogoMark } from '../brand/logo-mark';
import {
  logoRiderRotationDegrees,
  profileTipAtProgress,
  type ProfileChartPoint,
  type ProfileRenderModel,
  type ProfileScreenMap,
} from '../../utils/session-profile-chart';
import { useChartDraw } from './use-chart-draw';

/** The area's resting opacity, the same value the profile charts have always used. */
const PROFILE_AREA_OPACITY = 0.08;
/** The logo rider's width on screen. Its height follows the mark's aspect ratio. */
const LOGO_RIDER_SIZE = 22;
const LOGO_RIDER_HEIGHT = LOGO_RIDER_SIZE / LOGO_MARK_ASPECT_RATIO;
/**
 * The clip starts this far left of the chart and extends this far above and below it, so the
 * round line caps at the start are not cut off. The right edge is exactly the reveal edge.
 */
const CLIP_BLEED = 10;

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type ProfileRevealChartProps = {
  /** Also the SVG's testID. The logo rider gets `${testID}-logo-rider`. */
  testID: string;
  chart: ProfileRenderModel;
  /** The width the chart model was built with, in chart units. */
  width: number;
  /** The height the chart model was built with, in chart units, and the box height on screen. */
  height: number;
  /** Identifies this chart for the runtime. A new key draws again; a shown key starts at its end state. */
  animationKey: string;
  drawDuration: number;
  drawDelay?: number;
  lineColor: string;
  lineOpacity?: number;
  lineWidth: number;
  /** When set, the area under the line brightens to its resting opacity after the line starts. */
  areaColor?: string;
  /** When set, the logo rides the reveal edge on the first draw only, in this colour. */
  logoColor?: string;
};

/**
 * A profile line that draws left to right on its first show. The line is revealed with a clip
 * rectangle that grows from the left, because the SVG is stretched and `vectorEffect` keeps the
 * stroke width fixed, so a stroke dash would not line up. Numbers are never animated here: the
 * labels are the caller's and are already final.
 */
export function ProfileRevealChart(props: ProfileRevealChartProps): React.JSX.Element {
  const { chart, width, height, testID } = props;
  const draw = useChartDraw({
    animationKey: props.animationKey,
    drawDuration: props.drawDuration,
    drawDelay: props.drawDelay,
  });
  const { progress, areaProgress, fadeProgress } = draw;
  const reactId = useId();
  const clipId = `profile-reveal-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [box, setBox] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setBox(current =>
      current.width === nextWidth && current.height === nextHeight ? current : { width: nextWidth, height: nextHeight },
    );
  }, []);

  // Clip width in chart units: the right edge sits at progress * width.
  const clipProps = useAnimatedProps(() => ({ width: CLIP_BLEED + progress.get() * width }));
  const areaProps = useAnimatedProps(() => ({ fillOpacity: PROFILE_AREA_OPACITY * areaProgress.get() }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeProgress.get() }));

  const tipPoints = useMemo<ProfileChartPoint[]>(
    () => chart.points.map(point => ({ x: point.x, y: point.y })),
    [chart.points],
  );
  const screenMap = useMemo<ProfileScreenMap>(
    () => ({ viewBoxWidth: width, viewBoxHeight: height, width: box.width, height: box.height }),
    [width, height, box.width, box.height],
  );

  return (
    <View style={[styles.box, { height }]} onLayout={onLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.clip, fadeStyle]}>
        <Svg
          testID={testID}
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none">
          <Defs>
            <ClipPath id={clipId}>
              <AnimatedRect x={-CLIP_BLEED} y={-CLIP_BLEED} height={height + CLIP_BLEED * 2} animatedProps={clipProps} />
            </ClipPath>
          </Defs>
          {/* The water fills in behind the line rather than showing the whole shape ahead of it. */}
          {props.areaColor && chart.areaPath ? (
            <AnimatedPath clipPath={`url(#${clipId})`} d={chart.areaPath} fill={props.areaColor} animatedProps={areaProps} />
          ) : null}
          <Path
            clipPath={`url(#${clipId})`}
            d={chart.path}
            fill="none"
            stroke={props.lineColor}
            strokeOpacity={props.lineOpacity ?? 1}
            strokeWidth={props.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </Svg>
      </Animated.View>
      {/* A single sample draws no line, so there is nothing for the logo to ride. */}
      {props.logoColor && draw.drawsLine && tipPoints.length > 1 ? (
        <ProfileLogoRider
          testID={`${testID}-logo-rider`}
          color={props.logoColor}
          points={tipPoints}
          map={screenMap}
          progress={progress}
          opacity={draw.riderOpacity}
        />
      ) : null}
    </View>
  );
}

type ProfileLogoRiderProps = {
  testID: string;
  color: string;
  points: readonly ProfileChartPoint[];
  map: ProfileScreenMap;
  progress: SharedValue<number>;
  opacity: SharedValue<number>;
};

/**
 * The Divenary mark on the reveal edge, mirrored and turned so its nose follows the line, as on the
 * watch (`LogoRiderHeading`). Its centre is the line point; the rotation is the screen angle of the
 * line plus 57 degrees, and the flip comes first in the CSS order, so the mirrored mark is turned.
 */
function ProfileLogoRider(props: ProfileLogoRiderProps): React.JSX.Element {
  const { points, map, progress, opacity } = props;
  const style = useAnimatedStyle(() => {
    const tip = profileTipAtProgress(points, progress.get(), map);
    if (!tip) {
      return { opacity: 0 };
    }

    return {
      opacity: opacity.get(),
      transform: [
        { translateX: tip.x - LOGO_RIDER_SIZE / 2 },
        { translateY: tip.y - LOGO_RIDER_HEIGHT / 2 },
        { rotate: `${logoRiderRotationDegrees(tip.angleDegrees)}deg` },
        { scaleX: -1 },
      ],
    };
  });

  return (
    <Animated.View
      testID={props.testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.rider, style]}>
      <LogoMark width={LOGO_RIDER_SIZE} color={props.color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
  },
  clip: {
    overflow: 'hidden',
  },
  rider: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: LOGO_RIDER_SIZE,
    height: LOGO_RIDER_HEIGHT,
  },
});
