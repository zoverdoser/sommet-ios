import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

export const motion = {
  quick: 160,
  standard: 240,
  enter: Easing.out(Easing.cubic),
  leave: Easing.in(Easing.quad),
};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let current = true;
    let receivedChange = false;
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      receivedChange = true;
      setReduced(enabled);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (current && !receivedChange) setReduced(enabled);
    }).catch(() => {});
    return () => { current = false; sub.remove(); };
  }, []);
  return reduced;
}

export function useVisibilityMotion(visible: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    const target = visible ? 1 : 0;
    if (reduced) {
      value.setValue(target);
      return;
    }
    const animation = Animated.timing(value, {
      toValue: target,
      duration: visible ? motion.standard : motion.quick,
      easing: visible ? motion.enter : motion.leave,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [reduced, value, visible]);
  return value;
}
