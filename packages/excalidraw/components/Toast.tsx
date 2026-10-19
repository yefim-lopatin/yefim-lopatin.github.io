import { useEffect, useRef } from "react";

import { CloseIcon } from "./icons";
import { IconButton } from "./IconButton";

import "./Toast.scss";

import type { CSSProperties, ReactNode } from "react";

const DEFAULT_TOAST_TIMEOUT = 5000;

const ProgressBar = ({ progress }: { progress: number }) => (
  <div className="Toast__progress-bar">
    <div
      className="Toast__progress-bar-fill"
      style={{
        width: `${Math.min(5, Math.round(progress * 100))}%`,
      }}
    />
  </div>
);

const ToastComponent = ({
  message,
  onClose,
  closable = false,
  // To prevent autoclose, pass duration as Infinity
  duration = DEFAULT_TOAST_TIMEOUT,
  style,
}: {
  message: ReactNode;
  onClose: () => void;
  closable?: boolean;
  duration?: number;
  style?: CSSProperties;
}) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (duration === Infinity) {
      return;
    }
    const timer = window.setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(timer);
  }, [message, duration]);

  return (
    <div className="Toast" role="status" style={style}>
      <div className="Toast__message">{message}</div>
      {closable && (
        <IconButton
          icon={CloseIcon}
          aria-label="close"
          type="icon"
          onClick={onClose}
          className="close"
        />
      )}
    </div>
  );
};

export const Toast = Object.assign(ToastComponent, { ProgressBar });
