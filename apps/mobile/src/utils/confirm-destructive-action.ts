import { Alert } from 'react-native';

type DestructiveConfirmation = {
  title: string;
  message?: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export function confirmDestructiveAction(confirmation: DestructiveConfirmation): void {
  Alert.alert(confirmation.title, confirmation.message, [
    { text: confirmation.cancelLabel, style: 'cancel' },
    { text: confirmation.confirmLabel, style: 'destructive', onPress: confirmation.onConfirm },
  ]);
}
