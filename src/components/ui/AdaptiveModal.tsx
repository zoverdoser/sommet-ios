import React from 'react';
import { Modal, ModalProps } from 'react-native';
import { useReducedMotion } from '../../theme/motion';

export function AdaptiveModal({ animationType, ...props }: ModalProps) {
  const reduced = useReducedMotion();
  return <Modal {...props} animationType={reduced ? 'none' : animationType} />;
}
