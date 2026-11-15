import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from '../constants/theme';

/** Atmospheric background without depending on expo-linear-gradient. */
export function LinearGradientFallback() {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9000, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 9000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 24] });
  const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -16] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.base]} />
      <Animated.View style={[styles.blobTeal, { transform: [{ translateX }, { translateY }] }]} />
      <Animated.View
        style={[
          styles.blobInk,
          {
            transform: [
              { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -20] }) },
              { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 12] }) },
            ],
          },
        ]}
      />
      <View style={styles.grain} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#E8EEF5',
  },
  blobTeal: {
    position: 'absolute',
    top: -80,
    right: -40,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(15, 118, 110, 0.18)',
  },
  blobInk: {
    position: 'absolute',
    bottom: 40,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(20, 33, 61, 0.08)',
  },
  grain: {
    ...StyleSheet.absoluteFill,
    opacity: 0.35,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderTopColor: colors.paper,
  },
});
