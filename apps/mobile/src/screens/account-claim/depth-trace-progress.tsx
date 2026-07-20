import React from 'react';
import { AccessibilityInfo } from 'react-native';

import { Box } from '../../components/ui/box';
import { Progress, ProgressFilledTrack } from '../../components/ui/progress';

type DepthTraceProgressProps = {
  completed: number;
  total: number;
};

export function DepthTraceProgress({
  completed,
  total,
}: DepthTraceProgressProps): React.JSX.Element {
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const percent = safeTotal === 0 ? 0 : (safeCompleted / safeTotal) * 100;

  React.useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return (
    <Box className="relative py-1">
      <Progress
        testID="account-claim-progress"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: safeTotal, now: safeCompleted }}
        className="h-[2px] overflow-visible bg-primary/20"
        value={percent}
      >
        <ProgressFilledTrack
          testID="account-claim-progress-fill"
          className={reduceMotion ? 'h-[2px] transition-none' : 'h-[2px]'}
        />
      </Progress>
      <Box
        testID="account-claim-progress-tick"
        accessible={false}
        className="absolute top-0 h-2.5 w-0.5 rounded-full bg-primary"
        style={{ left: `${percent}%`, transform: [{ translateX: -1 }] }}
      />
    </Box>
  );
}
