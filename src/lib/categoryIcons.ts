import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Ionicons glyph for a vault category / label. */
export function categoryIconName(categoryLabel?: string): IconName {
  const c = (categoryLabel || '').toLowerCase();
  if (c.includes('vehicle') || c.includes('car') || c.includes('motor')) return 'car-outline';
  if (c.includes('insurance') && c.includes('health')) return 'medkit-outline';
  if (c.includes('insurance') || c.includes('life') || c.includes('home')) return 'shield-checkmark-outline';
  if (c.includes('bank')) return 'business-outline';
  if (c.includes('tax')) return 'document-text-outline';
  if (c.includes('identity') || c.includes('aadhaar') || c.includes('passport')) return 'id-card-outline';
  if (c.includes('health')) return 'medkit-outline';
  if (c.includes('travel')) return 'airplane-outline';
  if (c.includes('bill')) return 'flash-outline';
  if (c.includes('warrant')) return 'construct-outline';
  return 'document-outline';
}
