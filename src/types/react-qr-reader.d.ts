declare module 'react-qr-reader' {
  import * as React from 'react';

  export interface QrReaderProps {
    onResult?: (
      result: { text: string } | null | undefined,
      error: Error | null | undefined,
    ) => void;
    scanDelay?: number;
    constraints?: MediaStreamConstraints;
    style?: React.CSSProperties;
    containerStyle?: React.CSSProperties;
    videoStyle?: React.CSSProperties;
  }

  export const QrReader: React.FC<QrReaderProps>;
}
